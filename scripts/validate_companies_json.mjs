// Validates data/companies.json for CI (pull requests). Ensures the file is
// parseable and every row matches the shape expected by scripts/check_dmarc.mjs:
// an array of { name, domain } with non-empty strings. Domains must not
// contain whitespace so DNS lookups are unambiguous. No DMARC / network I/O.

import { readFile } from "node:fs/promises";

const INPUT_FILE = "data/companies.json";

const raw = await readFile(INPUT_FILE, "utf8");

/** @type {unknown} */
let parsed;
try {
  parsed = JSON.parse(raw);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`companies.json is not valid JSON: ${msg}`);
  process.exit(1);
}

// check_dmarc.mjs treats the file as a JSON array of company records.
if (!Array.isArray(parsed)) {
  console.error("companies.json must be a JSON array");
  process.exit(1);
}

for (let i = 0; i < parsed.length; i++) {
  const row = parsed[i];

  // Reject null, primitives, arrays; require plain objects only.
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    console.error(`Entry ${i}: must be an object`);
    process.exit(1);
  }

  const { name, domain } = /** @type {{ name?: unknown; domain?: unknown }} */ (row);

  if (typeof name !== "string" || name.trim() === "") {
    console.error(`Entry ${i}: "name" must be a non-empty string`);
    process.exit(1);
  }

  if (typeof domain !== "string" || domain.trim() === "") {
    console.error(`Entry ${i}: "domain" must be a non-empty string`);
    process.exit(1);
  }

  // After trim, no spaces/tabs/newlines remain — hostnames must be a single token for resolveTxt.
  if (/\s/.test(domain.trim())) {
    console.error(`Entry ${i}: "domain" must not contain whitespace`);
    process.exit(1);
  }
}

console.log(`OK: ${parsed.length} companies`);
