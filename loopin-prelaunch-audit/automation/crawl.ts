// Opens every screen in phone, tablet and desktop sizes, in Chrome (Chromium),
// Safari (WebKit) and Firefox engines, and records what a person would hit:
// HTTP status, where it ended up, page crashes, console errors, failed
// requests, broken images, sideways scrolling, small tap targets, unlabeled
// controls, and (Chromium phone) an axe-core accessibility scan.
import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from "playwright";
import { readFileSync } from "node:fs";
import { OUT, base, cookieFor, demo, ids, save } from "./common";

const AXE = readFileSync("node_modules/axe-core/axe.min.js", "utf8");

type Row = Record<string, unknown>;

async function main() {
  const x = await ids();
  const T = demo.trip.id, F = demo.flat.id, C = demo.couple.id;
  const routes: [string, string][] = [
    ["S001", "/"], ["S002", "/account"], ["S003", "/add"], ["S005", "/collect/new"], ["S006", "/faq"], ["S028", "/groups/new"],
    ["S029", "/how-it-works"], ["S030", "/import"], ["S032", "/notifications"], ["S036", "/passport"], ["S035", "/passport/friends"],
    ["S037", "/passport/send"], ["S040", "/postcards"], ["S039", "/postcards/new"], ["S041", "/postcards/stamps"], ["S042", "/privacy"],
    ["S043", "/private"], ["S044", "/search"], ["S045", "/settle"], ["S046", "/signin"], ["S047", "/signin/verify"], ["S048", "/splash"],
    ["S049", "/stats"], ["S050", "/switching"], ["S051", "/terms"], ["S052", "/welcome"],
    ["S015", `/groups/${T}`], ["S015", `/groups/${T}?tab=balances`], ["S015", `/groups/${T}?tab=charts`], ["S007", `/groups/${T}/add`],
    ["S014", `/groups/${T}/invite`], ["S020", `/groups/${T}/people`], ["S017", `/groups/${T}/passports`], ["S016", `/groups/${T}/passport/${demo.trip.ravi}`],
    ["S018", `/groups/${T}/pay`], ["S023", `/groups/${T}/report`], ["S024", `/groups/${T}/settings`], ["S025", `/groups/${T}/settle`],
    ["S026", `/groups/${T}/square`], ["S027", `/groups/${T}/wrapped`], ["S012", `/groups/${T}/expenses/${demo.trip.expenseId}/edit`],
    ["S015", `/groups/${F}`], ["S015", `/groups/${F}?tab=bills`], ["S015", `/groups/${F}?tab=list`], ["S009", `/groups/${F}/bills/new`],
    ["S010", `/groups/${F}/budgets`], ["S011", `/groups/${F}/deposit`], ["S019", `/groups/${F}/people/${demo.flat.kabir}/move`],
    ["S015", `/groups/${C}`], ["S031", `/join/${demo.trip.invite}`], ["S031", `/join/NOTAREALCODE`], ["S000", `/groups/not-a-real-group`], ["S000", `/this-page-does-not-exist`],
  ];
  if (x.bill) routes.push(["S008", `/groups/${F}/bills/${x.bill.id}`]);
  if (demo.couple.goal) routes.push(["S013", `/groups/${C}/goals/${demo.couple.goal}`]);
  if (x.pot) routes.push(["S015", `/groups/${x.pot.id}`], ["S022", `/groups/${x.pot.id}/pot/new`]);
  if (x.pot && x.game) routes.push(["S021", `/groups/${x.pot.id}/pot/${x.game.id}`]);
  if (x.postcard) routes.push(["S038", `/postcards/${x.postcard.id}`]);
  if (x.collection) routes.push(["S004", `/c/${x.collection.code}`]);
  if (x.payLink) routes.push(["S033", `/p/${x.payLink.token}`]);
  if (x.other) routes.push(["S034", `/passport/friends/${x.other.id}`]);
  const cookie = await cookieFor(x.memberships, x.account?.id);

  const configs: { key: string; engine: BrowserType; w: number; h: number; mobile: boolean; axe?: boolean; shot?: "full" | "view" }[] = [
    { key: "chromium-phone", engine: chromium, w: 390, h: 844, mobile: true, axe: true, shot: "full" },
    { key: "webkit-phone", engine: webkit, w: 390, h: 844, mobile: true, shot: "view" },
    { key: "firefox-phone", engine: firefox, w: 390, h: 844, mobile: false },
    { key: "chromium-small-phone", engine: chromium, w: 320, h: 640, mobile: true, shot: "view" },
    { key: "chromium-tablet", engine: chromium, w: 820, h: 1180, mobile: false, shot: "view" },
    { key: "chromium-desktop", engine: chromium, w: 1440, h: 900, mobile: false, shot: "view" },
    { key: "webkit-desktop", engine: webkit, w: 1440, h: 900, mobile: false },
    { key: "firefox-desktop", engine: firefox, w: 1440, h: 900, mobile: false },
  ];
  const want = (process.env.AUDIT_CONFIGS ?? "").split(",").filter(Boolean);
  const chosen = want.length ? configs.filter((c) => want.includes(c.key)) : configs;
  const rows: Row[] = [];
  const versions: Record<string, string> = {};
  for (const c of chosen) {
    let browser: Browser;
    try {
      browser = await c.engine.launch();
    } catch (e) {
      rows.push({ config: c.key, error: `browser did not start: ${String(e).slice(0, 200)}` });
      continue;
    }
    versions[c.key] = `${c.engine.name()} ${browser.version()}`;
    const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, isMobile: c.engine !== firefox && c.mobile, hasTouch: c.mobile, deviceScaleFactor: c.shot === "full" ? 2 : 1, colorScheme: "dark", locale: "en-IN", timezoneId: "Asia/Kolkata" });
    await ctx.addCookies([cookie, { name: "lp_tour", value: "1", url: base }]);
    for (const [sid, path] of routes) {
      const page: Page = await ctx.newPage();
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const failed: string[] = [];
      page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)));
      page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
      page.on("requestfailed", (r) => !/_rsc|favicon|\/api\/speed/.test(r.url()) && failed.push(`${r.failure()?.errorText} ${r.url().replace(base, "")}`.slice(0, 160)));
      page.on("response", (r) => r.status() >= 500 && failed.push(`${r.status()} ${r.url().replace(base, "")}`.slice(0, 160)));
      const row: Row = { config: c.key, screen: sid, path: path.replace(/[A-Za-z0-9_-]{20,}/g, ":id") };
      const t0 = Date.now();
      try {
        const res = await page.goto(base + path, { waitUntil: "load", timeout: 45_000 });
        await page.waitForTimeout(700);
        row.status = res?.status();
        row.loadMs = Date.now() - t0;
        row.finalPath = new URL(page.url()).pathname.replace(/[A-Za-z0-9_-]{20,}/g, ":id");
        row.title = await page.title();
        const m = await page.evaluate(({ mobile }) => {
          const vis = (el: Element) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
          };
          const imgs = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && vis(i)).map((i) => i.getAttribute("src")?.slice(0, 80));
          const noAlt = [...document.images].filter((i) => !i.hasAttribute("alt")).length;
          const controls = [...document.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab]")].filter(vis);
          const unnamed = controls.filter((el) => {
            const name = (el.getAttribute("aria-label") || el.getAttribute("title") || (el as HTMLElement).innerText || (el as HTMLInputElement).placeholder || "").trim();
            const labelled = el.id && document.querySelector(`label[for="${el.id}"]`);
            const wrapped = el.closest("label");
            return !name && !labelled && !wrapped && !el.getAttribute("aria-labelledby") && !el.querySelector("img[alt]:not([alt=''])");
          }).map((el) => el.outerHTML.slice(0, 100));
          const small = mobile
            ? controls.filter((el) => {
                const r = el.getBoundingClientRect();
                return (r.width < 32 || r.height < 32) && !(el.tagName === "A" && (el as HTMLElement).innerText.length > 2 && getComputedStyle(el).display === "inline");
              }).map((el) => `${el.tagName.toLowerCase()} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)} "${((el as HTMLElement).innerText || el.getAttribute("aria-label") || "").slice(0, 30)}"`)
            : [];
          const h1 = document.querySelectorAll("h1").length;
          const overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
          return { brokenImages: imgs, imagesWithoutAlt: noAlt, controls: controls.length, unnamed, small, h1, overflowX, textLen: document.body.innerText.length, height: document.documentElement.scrollHeight };
        }, { mobile: c.mobile });
        Object.assign(row, m);
        if (c.axe) {
          await page.addScriptTag({ content: AXE });
          const r = await page.evaluate(async () => {
            // @ts-expect-error injected
            const out = await window.axe.run(document, { resultTypes: ["violations"] });
            return out.violations.map((v: { id: string; impact: string; nodes: unknown[]; help: string }) => ({ id: v.id, impact: v.impact, count: v.nodes.length, help: v.help }));
          });
          row.axe = r;
        }
        if (c.shot) {
          const name = `${c.key}__${sid}__${path.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 60) || "home"}.png`;
          await page.screenshot({ path: `${OUT}/evidence/${name}`, fullPage: c.shot === "full" });
          row.evidence = `evidence/${name}`;
        }
      } catch (e) {
        row.error = String(e).split("\n")[0].slice(0, 200);
        try {
          await page.screenshot({ path: `${OUT}/evidence/ERR_${c.key}_${sid}.png` });
        } catch {}
      }
      row.consoleErrors = consoleErrors;
      row.pageErrors = pageErrors;
      row.failedRequests = failed;
      rows.push(row);
      await page.close();
      console.log(c.key, sid, path.slice(0, 50), row.status ?? row.error, row.loadMs ?? "");
    }
    await browser.close();
  }
  save(`crawl-${want.join("+") || "all"}.json`, { versions, rows });
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
