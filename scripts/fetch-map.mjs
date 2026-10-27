// Downloads a world map (svgMap by Stephan Wagner, MIT licence) during the
// build and saves it as one small SVG (public/world.svg) with a path per
// country, named by its two-letter code. The passport colours in the
// countries you've been to by pointing at those paths. If the download fails,
// the passport simply shows no map.
import { mkdirSync, writeFileSync } from "node:fs";

const URL = "https://cdn.jsdelivr.net/npm/svgmap@2.20.0/dist/index.js";
let ok = false;
let count = 0;
try {
  const r = await fetch(URL, { signal: AbortSignal.timeout(20_000) });
  const js = r.ok ? await r.text() : "";
  const paths = [];
  const re = /\b([A-Z]{2})\s*:\s*\{\s*d\s*:\s*'([^']+)'/g;
  for (let m; (m = re.exec(js)); ) paths.push([m[1], m[2]]);
  if (paths.length > 150) {
    const body = paths.map(([id, d]) => `<path id="${id}" d="${d}"/>`).join("");
    writeFileSync("public/world.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 1001"><g fill="#d9d1bc" stroke="#efe8d6" stroke-width="0.6">${body}</g></svg>`);
    ok = true;
    count = paths.length;
  }
} catch (e) {
  console.log("map: download failed", String(e).slice(0, 80));
}
mkdirSync("src/generated", { recursive: true });
writeFileSync("src/generated/map.json", JSON.stringify({ ok, count }));
console.log(`map: ${ok ? `${count} countries` : "not available"}`);
