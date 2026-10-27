// Finds free Unsplash photos for each place (search page, in a real browser).
const { chromium } = require("playwright");
const fs = require("fs");
const list = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => l.split("|"));
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" });
  const out = {};
  for (const [slot, query] of list) {
    try {
      await p.goto(`https://unsplash.com/s/photos/${encodeURIComponent(query.replace(/ /g, "-"))}?license=free`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await p.waitForSelector('img[src*="images.unsplash.com/photo-"]', { timeout: 45000 });
      await p.waitForTimeout(1500);
      const items = await p.$$eval('figure img[src*="images.unsplash.com/photo-"]', (imgs) => imgs.map((i) => ({ id: (i.getAttribute("src").match(/photo-[0-9]+-[0-9a-f]+/) || [""])[0], alt: i.getAttribute("alt") || "" })));
      const seen = new Set();
      out[slot] = items.filter((x) => x.id && !seen.has(x.id) && seen.add(x.id)).slice(0, 8);
      console.log(slot, out[slot].length);
    } catch (e) {
      console.log(slot, "ERR", String(e).split("\n")[0]);
      out[slot] = [];
    }
  }
  fs.writeFileSync("found.json", JSON.stringify(out, null, 1));
  await b.close();
})();
