// Downloads the real photos used on the "How Loopin works" page (free
// Unsplash photos, Unsplash License: free to use, no permission needed).
// Runs during the hosting build. For each picture it tries the candidates in
// order and keeps the first that downloads, so one missing photo never breaks
// the build — that section just shows a plain colour instead.
import { mkdirSync, writeFileSync } from "node:fs";

const SLOTS = {
  hero: ["V8oiNMhkLiw", "ka14QMQlS1U", "F6RLqhPPhDQ", "4IhrJtopGpc"], // beach / Goa
  roadtrip: ["cktp9-mCH4Y", "Gtno2Ua6aW4", "mSaYUDtC46M", "OiClXJ7jIU4"], // car, mountains
  dinner: ["F9wJ5TqWbjA", "hNijinANAFY", "NI9RN6S-Z20"], // friends at a restaurant
  market: ["URUoUgQdN1o", "zgP8AbxBO8c"], // street food abroad
  train: ["gv6RlH_8Plo", "JtbiKg_iVdA", "WNtOIZuk8pw", "5w2D_dB1hKQ"], // trains
  sunset: ["ka14QMQlS1U", "F6RLqhPPhDQ", "4IhrJtopGpc"], // settle up
  home: ["8czSAbHp5qI"], // flatmates at home
};

const out = "public/photos";
mkdirSync(out, { recursive: true });
const got = {};
for (const [slot, ids] of Object.entries(SLOTS)) {
  for (const id of ids) {
    try {
      const r = await fetch(`https://unsplash.com/photos/${id}/download?force=true&w=1280`, {
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
      got[slot] = { id, src: `/photos/${slot}.jpg`, page: `https://unsplash.com/photos/${id}` };
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
