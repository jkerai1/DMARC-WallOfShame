/**
 * Shared utilities and data loading for DMARC Wall of Shame (home + tools).
 * Loaded before page-specific scripts; exposes helpers on `window`.
 */

/** @type {string} Relative URL for the JSON dataset (domains with weak/missing DMARC). */
window.DMARC_DATA_URL = "non_dmarc.json";

/**
 * Fetches the domain list, deduplicates by domain (case-insensitive), and caches in sessionStorage.
 * Second visit in the same tab avoids a network round-trip when cache is valid.
 *
 * @returns {Promise<Array<{ domain: string, name?: string, status?: string, last_checked?: string }>>}
 * @throws {Error} When HTTP fetch fails (non-OK status).
 */
window.fetchDmarcData = async function () {
  const cached = sessionStorage.getItem("dmarc_data");
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (e) {
      /* ignore corrupt cache; refetch below */
    }
  }
  const res = await fetch(window.DMARC_DATA_URL);
  if (!res.ok) throw new Error("Failed to load data");
  const data = await res.json();
  const seen = new Map();
  for (const r of data) {
    if (!r || !r.domain) continue;
    const key = (r.domain || "").toLowerCase().trim();
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, r);
  }
  const cleaned = Array.from(seen.values());
  try {
    sessionStorage.setItem("dmarc_data", JSON.stringify(cleaned));
  } catch (e) {
    /* private mode / quota: still return data */
  }
  return cleaned;
};

/**
 * Returns a short TLD label for grouping/filtering (e.g. ".com", ".co.uk").
 * Multi-part public suffixes like co.uk are handled heuristically.
 *
 * @param {string} domain
 * @returns {string} Leading-dot TLD/suffix or em dash if not parseable.
 */
window.tldOf = function (domain) {
  if (!domain) return "—";
  const d = String(domain).toLowerCase().trim();
  if (!d.includes(".")) return "—";
  const parts = d.split(".");
  const last2 = parts.slice(-2).join(".");
  const known2 = ["co.uk", "co.jp", "com.cn", "org.uk", "ac.uk", "gov.uk", "io.", "org.au"];
  if (known2.includes(last2)) return "." + last2;
  return "." + parts[parts.length - 1];
};

/**
 * Human-readable label for a row's `status` field from the dataset.
 *
 * @param {string} s Raw status: `no_dmarc`, `p_none`, or other.
 */
window.statusLabel = function (s) {
  if (s === "no_dmarc") return "No DMARC record";
  if (s === "p_none") return "p=none (monitor only)";
  return s || "Unknown";
};

/**
 * Compact badge text for table cells (uppercase / short form).
 *
 * @param {string} s Same as statusLabel.
 */
window.statusShort = function (s) {
  if (s === "no_dmarc") return "NO RECORD";
  if (s === "p_none") return "p=none";
  return s || "?";
};

/**
 * Formats an ISO date string to YYYY-MM-DD for display.
 *
 * @param {string} iso Date string parseable by Date.
 * @returns {string} ISO date portion or em dash on failure.
 */
window.formatDate = function (iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toISOString().slice(0, 10);
  } catch (e) {
    return "—";
  }
};
