// Bulk DMARC auditor: reads company domains from data/companies.json, resolves
// _dmarc.<domain> TXT, and writes docs/non_dmarc.json listing domains with no
// record or policy p=none (quarantine/reject domains are omitted from output).
//
// Node's dns.resolve* paths use libuv's thread pool, which defaults to 4
// workers. Set UV_THREADPOOL_SIZE before starting node to at least your
// --concurrency (we default to 48). Example:
//   UV_THREADPOOL_SIZE=256 node scripts/check_dmarc.mjs
//
// Optional env:
//   DMARC_DNS_SERVERS=comma-separated IPs (e.g. 1.1.1.1,8.8.8.8) — faster, more
//     predictable than the runner's stub resolver; omit to use system defaults.
//   DMARC_QUERY_TIMEOUT_MS — per-query cap (default 12000).
//   DMARC_RETRY_ATTEMPTS — tries per domain for transient failures (default 3).
import dns from "node:dns";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import dnsPromises from "node:dns/promises";
import { parseArgs } from "node:util";

/** Source list: objects with at least { name, domain }. */
const INPUT_FILE = "data/companies.json";
/** Domains that lack DMARC or use p=none only; used by the site/docs. */
const OUTPUT_FILE = "docs/non_dmarc.json";
const DEFAULT_CONCURRENCY = 48;

/**
 * @param {string} name
 * @param {number} fallback
 */
function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Optional resolver override (`DMARC_DNS_SERVERS`) for speed/predictability on CI or bulk runs. */
function configureDnsFromEnv() {
  const raw = process.env.DMARC_DNS_SERVERS?.trim();
  if (!raw) return;
  const servers = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (servers.length > 0) dns.setServers(servers);
}

configureDnsFromEnv();

/**
 * “No usable answer” — definitive (do not retry); callers treat as no DMARC for this run.
 * @param {unknown} err
 * @returns {boolean}
 */
function isTerminalDnsError(err) {
  const c = err && typeof err === "object" && "code" in err ? String(/** @type {{ code: unknown }} */ (err).code) : "";
  return c === "ENODATA" || c === "ENOTFOUND" || c === "NXDOMAIN" || c === "FORMERR";
}

/**
 * Infrastructure / overload style failures worth backing off and retrying.
 * @param {unknown} err
 * @returns {boolean}
 */
function isRetryableDnsError(err) {
  if (isTerminalDnsError(err)) return false;
  const c = err && typeof err === "object" && "code" in err ? String(/** @type {{ code: unknown }} */ (err).code) : "";
  if (
    c === "ESERVFAIL" ||
    c === "ECONNRESET" ||
    c === "ETIMEOUT" ||
    c === "ETIMEDOUT" ||
    c === "EBUSY"
  ) {
    return true;
  }
  if (err instanceof Error && err.message === "DNS query timeout") return true;
  return false;
}

/**
 * node:dns/promises has no per-query deadline; clears stuck resolves after timeoutMs.
 * @param {string} hostname
 * @param {number} timeoutMs
 * @returns {Promise<string[][]>}
 */
function resolveTxtWithTimeout(hostname, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(Object.assign(new Error("DNS query timeout"), { code: "ETIMEOUT" }));
    }, timeoutMs);
    dnsPromises.resolveTxt(hostname).then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Parsed aggregate policy (`p=` tag): `none` | `quarantine` | `reject`, or null if not DMARC TXT.
 * RDATA may be split into multiple string chunks; tags are semicolon-separated `key=value`; missing `p` ⇒ `none`.
 * @param {string[]} chunks
 * @returns {string | null}
 */
function policyFromTxtChunks(chunks) {
  const record = chunks.join("");
  if (!record.includes("v=DMARC1")) {
    return null;
  }
  /** @type {Record<string, string>} */
  const tags = {};
  for (const part of record.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.includes("=")) continue;
    const i = trimmed.indexOf("=");
    const key = /** @type {string} */ (trimmed.slice(0, i));
    const val = trimmed.slice(i + 1);
    tags[key] = val;
  }
  return (tags.p ?? "none").toLowerCase();
}

/**
 * Lookup `_dmarc.<domain>` TXT with retries/backoff on transient resolver errors only.
 * @param {string} domain
 * @param {number} timeoutMs
 * @param {number} maxAttempts
 * @returns {Promise<string | null>}
 */
async function getDmarcPolicy(domain, timeoutMs, maxAttempts) {
  const host = `_dmarc.${domain}`;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const answers = await resolveTxtWithTimeout(host, timeoutMs);
      // First valid DMARC TXT wins if multiple RR strings exist for the name.
      for (const chunks of answers) {
        const policy = policyFromTxtChunks(chunks);
        if (policy !== null) return policy;
      }
      return null;
    } catch (err) {
      if (isTerminalDnsError(err)) return null;
      if (!isRetryableDnsError(err)) return null;
      if (attempt + 1 >= maxAttempts) return null;
      // Exponential backoff reduces thundering herd against resolvers under load.
      await new Promise((r) => setTimeout(r, 120 * 2 ** attempt));
    }
  }
  return null;
}

/**
 * Rows for domains that belong on the list: missing DMARC or `p=none` only (quarantine/reject omitted).
 * @param {{ name: string; domain: string }} company
 * @param {string | null} policy
 * @param {string} lastChecked
 * @returns {{ name: string; domain: string; status: string; last_checked: string } | null}
 */
function entryForCompany(company, policy, lastChecked) {
  const { domain } = company;
  let status;
  if (policy === null) {
    status = "no_dmarc";
  } else if (policy === "none") {
    status = "p_none";
  } else {
    return null;
  }
  return {
    name: company.name,
    domain,
    status,
    last_checked: lastChecked,
  };
}

/**
 * Run lookups with fixed concurrency via a semaphore (no extra deps); deterministic domain sort at end.
 * @param {{ name: string; domain: string }[]} companies
 * @param {number} concurrency
 * @param {number} timeoutMs
 * @param {number} maxAttempts
 * @returns {Promise<{ name: string; domain: string; status: string; last_checked: string }[]>}
 */
async function runParallelLookups(companies, concurrency, timeoutMs, maxAttempts) {
  const lastChecked = new Date().toISOString();
  let active = 0;
  /** @type {(() => void)[]} */
  const waitQueue = [];

  function takeSlot() {
    if (active < concurrency) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      waitQueue.push(() => {
        active++;
        resolve();
      });
    });
  }

  function releaseSlot() {
    active--;
    const next = waitQueue.shift();
    if (next) next();
  }

  /**
   * @param {{ name: string; domain: string }} company
   */
  async function one(company) {
    await takeSlot();
    try {
      const policy = await getDmarcPolicy(company.domain, timeoutMs, maxAttempts);
      return entryForCompany(company, policy, lastChecked);
    } finally {
      releaseSlot();
    }
  }

  const results = await Promise.all(companies.map((c) => one(c)));
  const flagged = results.filter((r) => r !== null);
  flagged.sort((a, b) => a.domain.localeCompare(b.domain)); // Stable doc diffs / browsing
  return flagged;
}

/**
 * @param {{ name: string; domain: string; status: string; last_checked: string }[]} flagged
 */
async function writeOutput(flagged) {
  const dir = dirname(OUTPUT_FILE);
  await mkdir(dir, { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(flagged, null, 2), "utf8");
}

const { values } = parseArgs({
  options: {
    // --concurrency: max simultaneous _dmarc lookups (balance resolver vs speed).
    concurrency: { type: "string", default: String(DEFAULT_CONCURRENCY) },
  },
});

const concurrency = Number.parseInt(values.concurrency, 10);
if (!Number.isFinite(concurrency) || concurrency < 1) {
  console.error("concurrency must be a positive integer");
  process.exit(1);
}

const queryTimeoutMs = Math.max(1000, intFromEnv("DMARC_QUERY_TIMEOUT_MS", 12_000));
const maxAttempts = Math.max(1, intFromEnv("DMARC_RETRY_ATTEMPTS", 3));

const t0 = performance.now();
const raw = await readFile(INPUT_FILE, "utf8");
const companies = JSON.parse(raw);
if (!Array.isArray(companies)) {
  console.error("companies.json must be a JSON array");
  process.exit(1);
}
const flagged = await runParallelLookups(companies, concurrency, queryTimeoutMs, maxAttempts);
await writeOutput(flagged);
const elapsed = (performance.now() - t0) / 1000;
// Machine-readable timing for cron/CI logs (counts include only “weak” DMARC outcomes).
console.log(`elapsed_seconds=${elapsed.toFixed(3)}`);
