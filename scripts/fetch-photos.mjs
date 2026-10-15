// Downloads the real photos used on the "How Loopin works" page (free
// Unsplash photos, Unsplash License: free to use, no permission needed).
// Runs during the hosting build. For each picture it tries the candidates in
// order and keeps the first that downloads, so one missing photo never breaks
// the build — that section just shows a plain colour instead.
import { mkdirSync, writeFileSync } from "node:fs";

// "photo-…" = a direct Unsplash image; anything else = an Unsplash photo page id.
const SLOTS = {
  hero: ["photo-1507525428034-b723cf961d3e", "V8oiNMhkLiw", "ka14QMQlS1U", "F6RLqhPPhDQ"], // beach
  roadtrip: ["photo-1469854523086-cc02fe5d8800", "photo-1506905925346-21bda4d32df4", "cktp9-mCH4Y", "Gtno2Ua6aW4"], // road trip, mountains
  dinner: ["photo-1760982192590-de2b005bb4d5", "photo-1750124933194-e021f47b5f8b", "photo-1414235077428-338989a2e8c0"], // a good bar
  market: ["photo-1547595429-da06b6a5080a", "photo-1750124933194-e021f47b5f8b", "photo-1504674900247-0877df9cc836"], // cocktails
  train: ["photo-1777026050794-a5e4ef7cd254", "photo-1618153231956-df23dcb21c07", "photo-1474487548417-781cb71495f3"], // Japanese bullet train
  sunset: ["photo-1502602898657-3e91760cbb34", "ka14QMQlS1U", "F6RLqhPPhDQ"], // a beautiful place
  home: ["photo-1768488314310-3742b3c75579", "photo-1746517757473-7c88850e539b", "photo-1522708323590-d24dbb6b0267"], // a cosy flat
};

const out = "public/photos";
mkdirSync(out, { recursive: true });
const got = {};
for (const [slot, ids] of Object.entries(SLOTS)) {
  for (const id of ids) {
    try {
      const url = id.startsWith("photo-")
        ? `https://images.unsplash.com/${id}?w=1280&q=75&fm=jpg&fit=crop`
        : `https://unsplash.com/photos/${id}/download?force=true&w=1280`;
      const r = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (Loopin build)" },
        signal: AbortSignal.timeout(20_000),
      });
      const type = r.headers.get("content-type") ?? "";
      const buf = Buffer.from(await r.arrayBuffer());
      if (!r.ok || !type.startsWith("image/") || buf.length < 20_000) {
        console.log(`photos: ${slot} ✗ ${id} (${r.status} ${type} ${buf.length} bytes)`);
        continue;
      }
      writeFileSync(`${out}/${slot}.jpg`, buf);
      got[slot] = { id, src: `/photos/${slot}.jpg` };
      console.log(`photos: ${slot} ✓ ${id} (${Math.round(buf.length / 1024)} KB)`);
      break;
    } catch (e) {
      console.log(`photos: ${slot} ✗ ${id} (${String(e).slice(0, 80)})`);
    }
  }
}
mkdirSync("src/generated", { recursive: true });
writeFileSync("src/generated/photos.json", JSON.stringify(got, null, 2));
console.log(`photos: ${Object.keys(got).length}/${Object.keys(SLOTS).length} ready`);
