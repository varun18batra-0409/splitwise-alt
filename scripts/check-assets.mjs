// Checks the files the build downloads (the world map and the share-picture fonts) before the database is touched.
// On the live deploy (VERCEL_ENV=production) a missing map or fewer than 6 fonts stops the deploy: the page would
// otherwise go live with no passport map or the wrong font. Anywhere else it only warns.
// CHECK_ASSETS_DIR (tests only) points at a folder holding map.json and og-fonts.json; default src/generated.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIN_FONTS = 6;
const dir = process.env.CHECK_ASSETS_DIR || "src/generated";
const production = process.env.VERCEL_ENV === "production";
const read = (name) => {
  try {
    return JSON.parse(readFileSync(join(dir, name), "utf8"));
  } catch {
    return null;
  }
};
const map = read("map.json");
const fonts = read("og-fonts.json");
const problems = [];
if (!map || map.ok !== true) problems.push("the world map did not download (map.json says not ok)");
const nFonts = fonts && typeof fonts === "object" ? Object.keys(fonts).length : 0;
if (nFonts < MIN_FONTS) problems.push(`only ${nFonts} of ${MIN_FONTS} share-picture fonts downloaded`);

if (!problems.length) {
  console.log(`check-assets: map (${map.count} countries) and ${nFonts} fonts are ready.`);
} else if (production) {
  for (const p of problems) console.error(`check-assets: ✗ ${p}`);
  console.error("check-assets: stopping the live deploy before any database change. Re-run the deploy; the download may have been a hiccup.");
  process.exit(1);
} else {
  for (const p of problems) console.log(`check-assets: warning: ${p} (not stopping: this is not the live deploy)`);
}
