const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  for (const f of ["HomeLight", "HomeDark", "Group", "Add", "StoryNew", "JoinNew"]) {
    await p.goto(`file://${__dirname}/${f}.html`, { waitUntil: "networkidle" });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${__dirname}/out/${f}.png` });
    console.log("shot", f);
  }
  await b.close();
})();
