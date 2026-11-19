// One-off accessibility check (report only). Needs the app on :3000 and .demo.json (scripts/seed-demo.ts), a throwaway database.
// Android phone (390x844, touch, en-IN). Per screen: axe (WCAG 2.0/2.1 A and AA), a normal screenshot, then the page at 200% text size
// (screenshot, sideways scrolling, cut-off text), the h1 count and a basic check of names and labels. Writes a11y/report.md, report.json, pictures.
import "./test-db-guard"; // first on purpose: refuses to run against the live database
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { base, signInOnTestCopy, withBypass } from "./hosted";

const demo = JSON.parse(readFileSync(".demo.json", "utf8"));
const out = "a11y";
mkdirSync(out, { recursive: true });

type Violation = { id: string; impact: string; help: string; count: number; selectors: string[] };
type Result = {
  key: string; title: string; path: string; reached: boolean; note: string; finalPath: string;
  violations: Violation[]; h1: number; sideways: boolean; scrollWidth200: number; cutOff: { selector: string; text: string }[];
  unnamed: string[]; unlabelled: string[]; error?: string;
};
const results: Result[] = [];

const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "en-IN", timezoneId: "Asia/Kolkata",
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36" };

// Runs in the page. Selector of an element, short.
function inPage() {
  const sel = (el: Element) => {
    let s = el.tagName.toLowerCase();
    if (el.id) return `${s}#${el.id}`;
    const c = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
    if (c) s += "." + c;
    return s;
  };
  const visible = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  };
  const cutOff: { selector: string; text: string }[] = [];
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    if (cutOff.length >= 5) break;
    const h = el as HTMLElement;
    const st = getComputedStyle(h);
    const hidden = st.overflowX === "hidden" || st.overflow === "hidden" || st.overflowX === "clip";
    const text = (h.innerText || "").trim();
    if (hidden && text && visible(h) && h.scrollWidth > h.clientWidth + 1 && h.clientWidth > 0) cutOff.push({ selector: sel(h), text: text.replace(/\s+/g, " ").slice(0, 60) });
  }
  const name = (el: Element) => (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title") || (el as HTMLElement).innerText || el.querySelector("img[alt]:not([alt=''])") || el.querySelector("svg title") || "").toString().trim();
  const unnamed = Array.from(document.querySelectorAll("button, a[href], [role=button], [role=link]")).filter((e) => visible(e) && !name(e)).slice(0, 5).map(sel);
  const unlabelled = Array.from(document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea"))
    .filter((e) => {
      if (!visible(e)) return false;
      const i = e as HTMLInputElement;
      return !(i.labels && i.labels.length) && !e.getAttribute("aria-label") && !e.getAttribute("aria-labelledby") && !e.getAttribute("title");
    }).slice(0, 5).map(sel);
  return {
    h1: document.querySelectorAll("h1").length,
    scrollWidth: document.documentElement.scrollWidth,
    sideways: document.documentElement.scrollWidth > window.innerWidth,
    cutOff, unnamed, unlabelled,
  };
}

async function openQuiet(p: Page, path: string) {
  const res = await p.goto(base + path, { waitUntil: "load", timeout: 45_000 });
  await p.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await p.waitForTimeout(900);
  return res;
}

async function check(ctx: BrowserContext, key: string, title: string, path: string, expectPrefix?: string) {
  const r: Result = { key, title, path, reached: false, note: "", finalPath: "", violations: [], h1: 0, sideways: false, scrollWidth200: 0, cutOff: [], unnamed: [], unlabelled: [] };
  results.push(r);
  const p = await ctx.newPage();
  try {
    const res = await openQuiet(p, path);
    const u = new URL(p.url());
    r.finalPath = u.pathname + u.search;
    const status = res?.status() ?? 0;
    r.reached = status < 400 && (!expectPrefix || u.pathname.startsWith(expectPrefix));
    if (!r.reached) r.note = status >= 400 ? `HTTP ${status}` : `redirected to ${r.finalPath}`;
    // a. axe at normal size
    const axe = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    r.violations = axe.violations.map((v) => ({ id: v.id, impact: v.impact ?? "none", help: v.help, count: v.nodes.length, selectors: v.nodes.slice(0, 2).map((n) => n.target.join(" ")) }));
    // b/c. normal screenshot, names, labels, h1
    await p.screenshot({ path: `${out}/${key}.png` });
    const normal = await p.evaluate(inPage);
    r.h1 = normal.h1; r.unnamed = normal.unnamed; r.unlabelled = normal.unlabelled;
    // 200% text
    await p.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await p.waitForTimeout(500);
    const big = await p.evaluate(inPage);
    r.sideways = big.sideways; r.scrollWidth200 = big.scrollWidth; r.cutOff = big.cutOff;
    await p.addStyleTag({ content: "[data-bottom-nav]{display:none !important}" }).catch(() => {});
    await p.screenshot({ path: `${out}/${key}-200pct.png`, fullPage: true }).catch(async (e) => {
      r.note += ` (full-page 200% picture failed: ${String(e).split("\n")[0]}; took the visible part)`;
      await p.screenshot({ path: `${out}/${key}-200pct.png` }).catch(() => {});
    });
  } catch (e) {
    r.error = String(e).split("\n")[0];
    r.note = (r.note + " " + r.error).trim();
  } finally {
    await p.close().catch(() => {});
  }
  const ids = [...new Set(r.violations.map((v) => v.id))].join(",") || "none";
  console.log(`${r.reached ? "✓" : "✗"} ${key} ${path} violations=${r.violations.length} ids=${ids} h1=${r.h1} sideways200=${r.sideways} cutoff200=${r.cutOff.length}${r.note ? " NOTE: " + r.note : ""}`);
}

async function main() {
  const browser = withBypass(await chromium.launch());
  // Signed-out phone: the welcome tour and the sign-in page.
  const anon = await browser.newContext(phone);
  await check(anon, "01-welcome", "Welcome", "/welcome");
  await check(anon, "02-signin", "Sign in", "/signin", "/signin");
  await check(anon, "03-privacy", "Privacy", "/privacy", "/privacy");
  await anon.close();

  // Signed in the way a person does (test email, code from the kept email): the demo person with her groups.
  const ctx = await browser.newContext(phone);
  await signInOnTestCopy(ctx, Object.values(demo.memberships) as string[]);
  const g = `/groups/${demo.trip.id}`;
  await check(ctx, "04-home", "Home", "/", "/");
  await check(ctx, "05-trip-group", "Trip group", g, g);
  await check(ctx, "06-add-expense", "Add expense", `${g}/add`, `${g}/add`);
  await check(ctx, "07-balances", "Group balances", `${g}?tab=balances`, g);
  await check(ctx, "08-settle-group", "Settle up (group)", `${g}/settle`, `${g}/settle`);
  await check(ctx, "09-settle-all", "Settle up (all groups)", "/settle", "/settle");
  await check(ctx, "10-history", "Group history (activity)", `${g}?tab=activity`, g);
  await check(ctx, "11-passport", "Passport", "/passport", "/passport");
  await check(ctx, "12-you", "You page", "/account", "/account");
  await check(ctx, "13-account-privacy", "Privacy (signed in)", "/account/privacy", "/account/privacy");

  // A postcard: the demo has none, so one is made on the throwaway copy, from a friend to the demo person.
  try {
    const { db } = await import("../src/lib/db");
    const me = await db.account.findFirstOrThrow({ where: { email: { startsWith: "shots-" } }, orderBy: { createdAt: "desc" } });
    const friend = await db.account.create({ data: { email: `a11y-meera-${Date.now()}@uat.loopin.test`, name: "Meera", passportChoiceAt: new Date() } });
    const card = await db.postcard.create({
      data: { fromId: friend.id, toId: me.id, groupId: "", front: "print:beach", words: "Goa", lettering: "classic", message: "Wish you were here. The beach shack turned out to be the fancy dinner.", hand: "caveat", stamp: "c:IN", paper: "cream", address: JSON.stringify(["Varun", "", ""]), place: "Goa" },
    });
    await check(ctx, "14-postcard", "Postcard (received)", `/postcards/${card.id}`, `/postcards/${card.id}`);
  } catch (e) {
    const note = "could not make a postcard: " + String(e).split("\n")[0];
    results.push({ key: "14-postcard", title: "Postcard (received)", path: "-", reached: false, note, finalPath: "", violations: [], h1: 0, sideways: false, scrollWidth200: 0, cutOff: [], unnamed: [], unlabelled: [], error: note });
    console.log("✗ 14-postcard", note);
  }
  await ctx.close();
  await browser.close();
  report();
}

function report() {
  const order = ["critical", "serious", "moderate", "minor"];
  const total: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const md: string[] = ["# Loopin accessibility check", "", `Android phone 390x844, touch, en-IN. axe tags: wcag2a, wcag2aa, wcag21a, wcag21aa. Throwaway demo data. Light colour scheme.`, ""];
  for (const r of results) {
    const by: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    for (const v of r.violations) { by[v.impact] = (by[v.impact] ?? 0) + 1; total[v.impact] = (total[v.impact] ?? 0) + 1; }
    const ids = [...new Set(r.violations.map((v) => v.id))].join(", ") || "none";
    console.log(`::notice title=a11y ${r.key} ${r.title}::reached=${r.reached} critical=${by.critical} serious=${by.serious} moderate=${by.moderate} minor=${by.minor} h1=${r.h1} sideways200=${r.sideways} cutoff200=${r.cutOff.length} rules: ${ids}`);
    md.push(`## ${r.title} (\`${r.path}\`)`, "", `Reached: ${r.reached ? "yes" : "NO"}${r.note ? ` (${r.note})` : ""}. Ended on \`${r.finalPath}\`. h1 count: ${r.h1}.`, "");
    if (r.violations.length) {
      md.push("| Rule | Impact | Help | Elements | First 2 selectors |", "|---|---|---|---|---|");
      for (const v of [...r.violations].sort((a, b) => order.indexOf(a.impact) - order.indexOf(b.impact))) md.push(`| ${v.id} | ${v.impact} | ${v.help.replace(/\|/g, "/")} | ${v.count} | ${v.selectors.map((s) => "`" + s.replace(/\|/g, "/") + "`").join("<br>")} |`);
    } else md.push("No axe violations.");
    md.push("", `At 200% text: sideways scroll ${r.sideways ? "YES" : "no"} (page width ${r.scrollWidth200}px, window 390px). Cut-off text: ${r.cutOff.length ? "" : "none"}`);
    for (const c of r.cutOff) md.push(`- \`${c.selector}\`: "${c.text}"`);
    md.push(`Buttons/links with no name: ${r.unnamed.length ? r.unnamed.map((s) => "`" + s + "`").join(", ") : "none"}. Fields with no label: ${r.unlabelled.length ? r.unlabelled.map((s) => "`" + s + "`").join(", ") : "none"}.`, "", `Pictures: \`${r.key}.png\`, \`${r.key}-200pct.png\``, "");
  }
  const rules = new Map<string, { impact: string; help: string; screens: string[] }>();
  for (const r of results) for (const v of r.violations) { const e = rules.get(v.id) ?? { impact: v.impact, help: v.help, screens: [] }; e.screens.push(r.key); rules.set(v.id, e); }
  const sum = ["## Summary", "", `Violations by impact (rule-per-screen counts): critical ${total.critical}, serious ${total.serious}, moderate ${total.moderate}, minor ${total.minor}.`, "",
    `Screens not reached: ${results.filter((r) => !r.reached).map((r) => r.key + " (" + r.note + ")").join("; ") || "none"}.`, "", "| Rule | Impact | Help | Screens |", "|---|---|---|---|"];
  for (const [id, e] of [...rules].sort((a, b) => order.indexOf(a[1].impact) - order.indexOf(b[1].impact) || b[1].screens.length - a[1].screens.length)) sum.push(`| ${id} | ${e.impact} | ${e.help.replace(/\|/g, "/")} | ${e.screens.length} (${e.screens.join(", ")}) |`);
  md.splice(4, 0, ...sum, "");
  writeFileSync(`${out}/report.md`, md.join("\n"));
  writeFileSync(`${out}/report.json`, JSON.stringify(results, null, 2));
  console.log(`::notice title=a11y summary::critical ${total.critical}, serious ${total.serious}, moderate ${total.moderate}, minor ${total.minor}; rules: ${[...rules.keys()].join(", ")}`);
  console.log("----- REPORT -----\n" + md.join("\n"));
}

main().catch((e) => { console.error("✗ a11y check crashed", e); process.exit(1); });
