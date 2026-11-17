// Fonts for the share pictures (passport, Wrapped…), downloaded during the
// build: the picture maker needs .woff files (the app itself uses .woff2).
// If a download fails, the pictures fall back to the default font.
import { mkdirSync, writeFileSync } from "node:fs";

const FONTS = {
  "display-600": "https://cdn.jsdelivr.net/npm/@fontsource/fraunces@5/files/fraunces-latin-600-normal.woff",
  "display-700": "https://cdn.jsdelivr.net/npm/@fontsource/fraunces@5/files/fraunces-latin-700-normal.woff",
  "sans-500": "https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-500-normal.woff",
  "sans-700": "https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-700-normal.woff",
  // Currency signs the latin set leaves out (₹ is U+20B9): used when a font lacks them.
  "sans-ext-500": "https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-ext-500-normal.woff",
  "sans-ext-700": "https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-ext-700-normal.woff",
};
mkdirSync("public/og-fonts", { recursive: true });
const got = {};
for (const [name, url] of Object.entries(FONTS)) {
  // Up to 3 tries per font: a slow or failed download is often gone a few seconds later.
  for (let attempt = 1; attempt <= 3 && !got[name]; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const buf = Buffer.from(await r.arrayBuffer());
      if (!r.ok || buf.length < 5_000) throw new Error(`${r.status} ${buf.length} bytes`);
      writeFileSync(`public/og-fonts/${name}.woff`, buf);
      got[name] = `/og-fonts/${name}.woff`;
    } catch (e) {
      console.log(`fonts: ${name} ✗ ${String(e).slice(0, 80)}${attempt < 3 ? " (trying again)" : ""}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}
mkdirSync("src/generated", { recursive: true });
writeFileSync("src/generated/og-fonts.json", JSON.stringify(got));
console.log(`fonts: ${Object.keys(got).length}/${Object.keys(FONTS).length} ready`);
