// One way to compare database addresses, so "the same database written two ways" is still caught.
// Lowercase; no scheme (libsql://, https://, http://, wss://, ws://); no query string; no trailing slashes.
// Used by scripts/test-db-rule.ts and by the "not the live database" checks in the e2e and staging workflows:
//   node scripts/db-address.mjs differ "$ADDRESS_A" "$ADDRESS_B"   exit 0 only if both are given and are different databases;
//                                                                   anything else (same, empty, a crash) is non-zero, so a check using it fails closed
//   node scripts/db-address.mjs same "$ADDRESS_A" "$ADDRESS_B"     exit 0 if they are the same database, 1 if not
export function normaliseDbAddress(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^(libsql|https|http|wss|ws):\/\//, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

export function sameDb(a, b) {
  const x = normaliseDbAddress(a);
  return x !== "" && x === normaliseDbAddress(b);
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && ["same", "differ"].includes(process.argv[2])) {
  const [, , mode, a, b] = process.argv;
  if (mode === "same") process.exit(sameDb(a, b) ? 0 : 1);
  process.exit(normaliseDbAddress(a) && normaliseDbAddress(b) && !sameDb(a, b) ? 0 : 1);
}
