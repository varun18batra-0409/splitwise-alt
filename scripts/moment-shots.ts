// Shared by the screenshots and the UAT: real photos for moments, and a check that every moment photo on the page truly drew.
// (A moment added with a hand-made file, or the app icon, shows as nothing or as the Loopin "L", which hides real problems.)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { Page } from "playwright";

// The real place photos the build downloads (public/photos/place-thailand.jpg, place-thailand-2.jpg…). Fails loudly when there are none.
export function realPhotos(place = "thailand"): { name: string; mimeType: string; buffer: Buffer }[] {
  const dir = "public/photos";
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => new RegExp(`^place-${place}(-\\d+)?\\.jpg$`).test(f)).sort() : [];
  if (files.length === 0) throw new Error(`No real photos for "${place}" in ${dir}: the photo download (scripts/fetch-photos.mjs) did not run or failed, so moments cannot be tested with real pictures.`);
  return files.map((f) => ({ name: f, mimeType: "image/jpeg", buffer: readFileSync(`${dir}/${f}`) }));
}

// Waits for every moment photo on the page (the small ones, the big one and the story frame) to load, then fails loudly if any did not
// draw (naturalWidth 0). Photos are lazy: a full-page capture never scrolls, so they are scrolled into view and made eager first.
export async function assertMomentPhotosDecoded(p: Page, label: string): Promise<number> {
  const bad: string[] = [];
  await p.evaluate(async () => {
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="/api/moment-photo/"]'));
    for (const im of imgs) im.loading = "eager";
    for (const im of imgs) im.scrollIntoView({ block: "center" });
    window.scrollTo(0, 0);
  });
  // No named functions inside the browser code: the script runner adds a helper (__name) that the page doesn't have.
  await p
    .waitForFunction(() => Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="/api/moment-photo/"]')).every((im) => im.complete), undefined, { timeout: 10_000 })
    .catch(() => undefined);
  const total = await p.locator('img[src*="/api/moment-photo/"]').count();
  const states = await p.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLImageElement>('img[src*="/api/moment-photo/"]'))
      .filter((im) => im.getClientRects().length > 0)
      .map((im) => ({ src: im.getAttribute("src") ?? "", ok: im.complete && im.naturalWidth > 0 })),
  );
  for (const s of states) if (!s.ok) bad.push(s.src);
  if (bad.length > 0) throw new Error(`${label}: ${bad.length} moment photo(s) did not decode (naturalWidth 0): ${bad.slice(0, 3).join(", ")}`);
  return Math.max(total, states.length);
}
