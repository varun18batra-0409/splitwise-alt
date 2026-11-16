// Lists the places people named that Loopin has no photo for, so new place photos can be added.
// READ-ONLY (one SELECT). Run by the "Unknown places" workflow (needs TURSO_DATABASE_URL / TURSO_AUTH_TOKEN).
// The repository is PUBLIC, so only AGGREGATES are output: a place name that at least 2 different trips named
// (so no single person's trip can be picked out), most-named first, at most 200. Never group ids, names, people or tags.
import { createClient } from "@libsql/client";
import { writeFileSync } from "node:fs";

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const exists = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='UnknownPlace'")).rows.length > 0;
const rows = exists ? (await db.execute("SELECT place, groups FROM UnknownPlace WHERE groups >= 2 ORDER BY groups DESC, place ASC LIMIT 200")).rows : [];
// Re-check each name before it goes anywhere public: letters, spaces, hyphens, apostrophes only.
const places = rows.map((r) => ({ place: String(r.place), trips: Number(r.groups) })).filter((p) => /^[\p{L}][\p{L} '-]{1,39}$/u.test(p.place));
writeFileSync("unknown-places.json", JSON.stringify({ updated: new Date().toISOString().slice(0, 10), places }, null, 1) + "\n");
const md = [`## Places without a photo (named by 2 or more trips)`, ""];
md.push(exists ? (places.length ? "| place | trips |\n|---|---|\n" + places.map((p) => `| ${p.place} | ${p.trips} |`).join("\n") : "(none yet)") : "(not recorded yet: the table is not created)");
writeFileSync("unknown-places.md", md.join("\n") + "\n");
db.close();
