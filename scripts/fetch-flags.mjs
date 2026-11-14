// Downloads a small PNG flag for every country the app knows (src/lib/geo.ts), from flagcdn.com, into public/flags/xx.png and
// xx@2x.png. Real image files because flag emoji show as two letters on Windows. Runs during the hosting build. A flag that
// doesn't download is skipped (the <Flag> picture then shows the country's letter code); this never fails the build.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

try {
  const src = readFileSync("src/lib/geo.ts", "utf8");
  const codes = [...new Set([...src.matchAll(/\bC\("([A-Z]{2})"/g)].map((m) => m[1]))];
  const out = "public/flags";
  mkdirSync(out, { recursive: true });
  let ok = 0;
  const get = async (code, width, file) => {
    if (existsSync(file)) return true;
    try {
      const r = await fetch(`https://flagcdn.com/w${width}/${code.toLowerCase()}.png`, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok || !(r.headers.get("content-type") || "").includes("image")) return false;
      writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      return true;
    } catch {
      return false;
    }
  };
  for (let i = 0; i < codes.length; i += 12) {
    const batch = codes.slice(i, i + 12);
    const res = await Promise.all(batch.map(async (c) => {
      const a = await get(c, 80, `${out}/${c.toLowerCase()}.png`);
      if (a) await get(c, 160, `${out}/${c.toLowerCase()}@2x.png`);
      return a;
    }));
    ok += res.filter(Boolean).length;
  }
  console.log(`flags: ${ok} of ${codes.length}`);
} catch (e) {
  console.log("flags: skipped", String(e).slice(0, 80));
}
