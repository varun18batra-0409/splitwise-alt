import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
const c = JSON.parse(readFileSync("cands.json", "utf8"));
const slots = Object.entries(c).filter(([, v]) => v.length);
mkdirSync("sheet", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1640, height: 900 } });
for (let p = 0; p * 10 < slots.length; p++) {
  const rows = slots.slice(p * 10, p * 10 + 10).map(([slot, v]) =>
    `<div class=row><b>${slot}</b>${v.map((o, i) => `<figure><img src="https://images.unsplash.com/${o.id}?w=600&h=390&fit=crop&q=60"><figcaption>${i + 1}</figcaption></figure>`).join("")}</div>`).join("");
  await page.setContent(`<style>body{margin:0;background:#111;color:#eee;font:16px sans-serif;padding:6px}.row{display:flex;flex-wrap:wrap;width:1620px;gap:6px;align-items:center;margin-bottom:8px}b{width:150px;flex:none;font-size:22px}figure{margin:0;position:relative}img{width:300px;height:195px;object-fit:cover;display:block;background:#333}figcaption{position:absolute;top:2px;left:4px;background:#000a;padding:0 4px;font-weight:bold}</style>${rows}`, { waitUntil: "networkidle", timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `sheet/sheet-${String(p + 1).padStart(2, "0")}.png`, fullPage: true });
}
await browser.close();
