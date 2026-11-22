import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Rules about the code itself for "add expenses offline": the phone never works out money, both doors into saving stay equal,
// and nothing personal is copied to the phone.
const src = (p: string) => readFileSync(`${__dirname}/../${p}`, "utf8");
const files = (dir: string) => readdirSync(`${__dirname}/../${dir}`).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => `${dir}/${f}`);

describe("the phone never works out money", () => {
  const screens = [...files("src/components/offline"), ...files("src/app/offline-app")];
  const phoneLib = ["store", "idb", "client", "describe", "memory-kv", "words", "types", "snapshot-types"].map((n) => `src/lib/offline/${n}.ts`);
  it("the offline screens and the phone's own code do not import the split, totals or expense builders", () => {
    expect(screens.length).toBeGreaterThan(5);
    for (const f of [...screens, ...phoneLib]) {
      const text = src(f).replace(/^import type .*$/gm, ""); // (a type-only import is erased: it can not run any code)
      expect(text, f).not.toMatch(/from "@\/lib\/split"|from "(\.\.?\/)+split"|from "@\/lib\/expense"|from "(\.\.?\/)+expense"|computeTotals|buildExpense|from "@\/lib\/conversion"|from "(\.\.?\/)+conversion"/);
    }
  });
  it("and none of it reaches the database", () => {
    for (const f of [...screens, ...phoneLib]) expect(src(f), f).not.toMatch(/from "@\/lib\/db"|from "(\.\.?\/)+db"|@prisma/);
  });
  it("a draft's type holds typed values only: no shares result, total, converted amount or balance", () => {
    const t = src("src/lib/offline/types.ts");
    const draft = t.slice(t.indexOf("export type DraftInput"), t.indexOf("export type DraftStatus"));
    for (const word of ["convertedAmount", "total", "balance", "markupAmount", "originalAmount", "exchangeRate"]) expect(draft).not.toContain(word);
  });
});

describe("both doors into saving stay equal", () => {
  it("the Add screen's action and the offline route both use the shared checks, and the route sends through sendDraft", () => {
    expect(src("src/app/actions.ts")).toContain("addExpenseChecks(");
    const route = src("src/app/api/offline/add/route.ts");
    expect(route).toContain("addExpenseChecks(");
    expect(route).toContain("sendDraft(");
    expect(route).toContain("getMyMemberId(");
    expect(route).toContain("ownOrigin(");
  });
  it("sendDraft calls saveExpense, with the guest rules, the duplicate check and what the phone saw", () => {
    const send = src("src/lib/offline/send.ts");
    expect(send).toContain("saveExpense(");
    for (const needle of ["guestRules: true", "checkDuplicate: true", "expect:", "requestKey: key"]) expect(send).toContain(needle);
    expect(send).toContain("me !== draft.memberId");
  });
  it("the daily clean-up goes through the helper that keeps off- keys 400 days", () => {
    expect(src("src/app/api/cron/daily/route.ts")).toContain("cleanOldKeys(");
    const c = src("src/lib/offline/key-cleanup.ts");
    expect(c).toContain("OFFLINE_KEY_KEEP_DAYS");
    expect(src("src/lib/offline/words.ts")).toContain("OFFLINE_KEY_KEEP_DAYS = 400");
  });
});

describe("nothing personal goes to the phone", () => {
  it("the copy of a group has no phone or email field, and the builder does not read them", () => {
    const t = src("src/lib/offline/snapshot-types.ts").replace(/\/\/.*$/gm, "");
    expect(t).not.toMatch(/phone|email/i);
    expect(src("src/lib/offline/snapshot.ts").replace(/\/\/.*$/gm, "")).not.toMatch(/\.phone|\.email|accountId/);
  });
});

describe("the switch", () => {
  it("with OFFLINE_ADD off: the offline screen does not exist, the layout tells the service worker to forget it, and no copies are kept", () => {
    expect(src("src/app/offline-app/page.tsx")).toContain("if (!offlineOn()) notFound()");
    expect(src("src/app/layout.tsx")).toContain("<InstallCapture offline={offlineOn()}");
    expect(src("src/components/offline/OfflineSync.tsx")).toContain("dropAllSnapshots(");
    expect(src("src/app/groups/[id]/page.tsx")).toContain("offlineOn() && fv");
    expect(src("src/app/api/offline/add/route.ts")).toContain("!offlineOn()");
  });
  it("the service worker redirects only when it has kept the screen, and keeps the push and notification parts", () => {
    const sw = src("public/sw.js");
    expect(sw).toContain("if (to && (await saved(SHELL)");
    expect(sw).toContain("d.offline === false");
    for (const needle of ['addEventListener("push"', 'addEventListener("notificationclick"', "showNotification", "openWindow", "clients.claim()", "skipWaiting()"]) expect(sw).toContain(needle);
  });
  it("signing out and deleting the account wipe the phone's offline database", () => {
    expect(src("src/lib/offline/signout.ts")).toContain("wipeAll(kv)"); // after the server has said no account is here
    expect(src("src/app/account/sign-in/page.tsx")).toContain("wipesOffline");
    expect(src("src/app/account/data/page.tsx")).toContain("wipesOffline");
  });
  it("the Back-online check runs on online, pageshow, focus and visibilitychange, and every few seconds", () => {
    const h = src("src/components/offline/useSignal.ts");
    for (const ev of ['"online"', '"pageshow"', '"focus"', '"visibilitychange"', "setInterval"]) expect(h).toContain(ev);
    const app = src("src/components/offline/OfflineApp.tsx");
    expect(app).toContain("window.location.replace(real)");
    expect(app).toContain("data-offline-try-again");
  });
  it("the wipe comes AFTER the server has signed out (a note is left, the next page settles it), only when something is stored, and a failed sign-out loses nothing", () => {
    const c = src("src/components/ConfirmButton.tsx");
    expect(c).toContain("hasOfflineData()");
    expect(c).toContain("localStorage.setItem(WIPE_FLAG");
    expect(c).not.toContain("await wipePhone()");
    const sync = src("src/components/offline/OfflineSync.tsx");
    expect(sync).toContain("settleSignOutNote(");
    expect(sync.indexOf("settleSignOutNote(")).toBeLessThan(sync.indexOf("if (!on)"));
    const so = src("src/lib/offline/signout.ts");
    expect(so.indexOf("applyMe(kv, {})")).toBeLessThan(so.indexOf("await ask()")); // hidden before the server is asked
    expect(so).toContain("if (me.left || !me.account)");
    expect(so).toContain("RESTORE_AFTER_MS"); // an "account" answer straight after the tap is never taken as "still signed in"
  });
  it("/api/offline/me: a database problem is a 503, never 'no account'; the account answer comes even with the switch off", () => {
    const m = src("src/app/api/offline/me/route.ts");
    expect(m).toContain("status: 503");
    expect(m.indexOf("account")).toBeLessThan(m.indexOf("if (!offlineOn())"));
  });
  it("the ONLINE add form behaves as on the live app: its own key, the live 'couldn't confirm' message, no 'Save on this phone', no lock, no day-rate flag; only offline-screen props differ", () => {
    const f = src("src/components/AddExpenseForm.tsx");
    expect(f).toContain("const generatedKey = useRequestKey();\n  const requestKey = fixed?.key ?? generatedKey;");
    expect(f).toContain('setError("We couldn’t confirm this saved. What you typed is still here: tap Save again when you’re back online. It won’t be added twice.");');
    for (const gone of ["keepOffline", "locked", "offerPhone", "offerNote", "OFFLINE_KEY_PREFIX", "rateOnDay", "isFixed", "<fieldset", "photoNotKept", "itemsNotKept"]) expect(f, gone).not.toContain(gone);
    expect(f).toContain("if (saving) return; // a late Speak / AI answer");
    // The only places Save on this phone exists: the offline screen (`offline`), through keepOnPhone(newDraftKey(), ...).
    expect(f.match(/keepOnPhone\(/g)?.length).toBe(2); // the definition and the one call
    expect(f).toContain("await keepOnPhone((offlineKey.current ??= newDraftKey()), offline.onSaved)");
    expect(src("src/app/groups/[id]/add/page.tsx")).not.toContain("keepOffline");
    const a = src("src/app/actions.ts");
    expect(a).not.toContain("rateOnDay");
    expect(a).not.toContain("getRateOn");
    expect(a).toContain("export async function lookupRate(from: string, to: string)");
    const rc = src("src/lib/rate-cache.ts");
    expect(rc.slice(rc.indexOf("export async function getRateOn"), rc.indexOf("export async function displayRate"))).not.toContain("exchangeRate.create");
    expect(rc).toContain('orderBy: { fetchedAt: "desc" }');
    for (const gone of ["alsoKey", "earlier.ts"]) expect(src("src/lib/save-expense.ts") + src("src/lib/offline/send.ts")).not.toContain(gone);
  });
  it("only in fix mode, another currency on an earlier day asks for the day's rate (empty box, own-rate mode, the note); the normal form is not touched", () => {
    const f = src("src/components/AddExpenseForm.tsx");
    expect(f).toContain("fixNeedsOwnRate({ isFix: Boolean(fixed), foreign, day: date, today })");
    expect(f).toContain("W.fixRateNote(niceDate(date))");
    expect(f).toContain("ownRateOnly");
    expect(src("src/lib/offline/fix-rate.ts")).toContain("o.isFix && o.foreign && o.day < o.today");
  });
  it("the whole e2e suite runs with the switch UNSET as on live; the offline spec has its own step with it ON", () => {
    const y = src(".github/workflows/e2e.yml");
    expect(y).toContain("npx playwright test --project=phone; a=$?");
    expect(y).toContain("E2E_RUN_TAG=ios npx playwright test --project=iphone; b=$?");
    expect(y.slice(0, y.indexOf("# Add expenses offline is off"))).not.toContain("OFFLINE_ADD");
    expect(y).toContain("OFFLINE_ADD=1 E2E_PLAIN_HTTP=1 npm run start");
    expect(y).toContain("E2E_OFFLINE=1 E2E_RUN_TAG=offline npx playwright test e2e/tests/54-offline-add.spec.ts --project=phone");
    expect(src("playwright.config.ts")).toContain('process.env.E2E_OFFLINE === "1" ? undefined : /54-offline-add');
    expect(src(".github/workflows/ci.yml")).not.toContain("OFFLINE_ADD");
  });
  it("the offline screen's files are saved all-or-nothing: any listed file that is not ok fails the save and the older copy stays", () => {
    const sw = src("public/sw.js");
    expect(sw).toContain('if (!r.ok) throw new Error("file " + f + " " + r.status)');
    expect(sw.indexOf("await caches.delete(name)")).toBeLessThan(sw.lastIndexOf("for (const k of await caches.keys())")); // the old ones go only after the try completed
  });
  it("one draft key per opened offline form", () => {
    const f = src("src/components/AddExpenseForm.tsx");
    expect(f).toContain("(offlineKey.current ??= newDraftKey())");
  });
  it("a sign-out is settled only on its own landing: the actions leave a short note, the phone reads it through /me, and /me and /status are rate limited", () => {
    const a = src("src/app/actions.ts");
    expect(a.match(/formData\?\.get\("offline_wipe"\) === "1"\) await markLeft\(\)/g)?.length).toBe(2);
    expect(src("src/app/api/offline/me/route.ts")).toContain("takeLeft()");
    expect(src("src/app/api/offline/me/route.ts")).toContain("allow(`offline-me:");
    expect(src("src/app/api/offline/status/route.ts")).toContain("allow(`offline-status:");
    const c = src("src/components/ConfirmButton.tsx");
    expect(c).toContain("allDraftsCount(openStore())");
    expect(c).toContain('mark.name = "offline_wipe"');
  });
  it("with the switch off a phone that never stored anything is never given a database; faq and privacy are built with the page as on live", () => {
    const i = src("src/lib/offline/idb.ts");
    expect(i).toContain('localStorage.getItem(USED_HINT) !== "1"');
    expect(src("src/app/faq/page.tsx")).not.toContain("force-dynamic");
    expect(src("src/app/privacy/page.tsx")).not.toContain("force-dynamic");
    expect(src("src/lib/rate-cache.ts")).toContain("which may\n// write an ExchangeRate row exactly as an online save does");
  });
  it("Delete account has its own words for waiting expenses, and the note is hidden-first in its own step", () => {
    const w = src("src/lib/offline/words.ts");
    expect(w).toContain("Deleting your account removes");
    expect(src("src/app/account/data/page.tsx")).toContain("deletes");
    const c = src("src/components/ConfirmButton.tsx");
    expect(c).toContain("(deletes ? W.deleteWarn : W.signOutWarn)(waiting)");
    expect(c.indexOf("await applyMe(openStore(), {})")).toBeLessThan(c.indexOf("localStorage.setItem(WIPE_FLAG"));
    expect(c.slice(c.indexOf("await applyMe(openStore(), {})"), c.indexOf("localStorage.setItem(WIPE_FLAG"))).toContain("} catch {"); // its own try
  });
  it("Open and fix opens only the signed-in person's draft", () => {
    expect(src("src/components/offline/OfflineFix.tsx")).toContain("d.memberId === formProps.myId");
    const form = src("src/components/AddExpenseForm.tsx");
    expect(form).not.toContain("W.itemsNotKept");
  });
  it("a browser without requestSubmit still signs out", () => {
    for (const p of ["src/app/account/sign-in/page.tsx", "src/app/account/data/page.tsx"]) {
      const t = src(p);
      expect(t).toContain("wipesOffline");
      expect(t).not.toContain("wipesOffline={offlineOn()}"); // no longer tied to the switch: anything stored is cleared
    }
    const c = src("src/components/ConfirmButton.tsx");
    expect(c).toContain('typeof form.requestSubmit === "function"');
    expect(c).toContain("form.submit()");
  });
  it("the offline Add screen does not jump away from what is being typed once the signal returns", () => {
    const app = src("src/components/offline/OfflineApp.tsx");
    expect(app).toContain('where.s === "add" && touched.current');
    expect(app).toContain("holdBack");
    expect(app).toContain("data-offline-back-online");
  });
  it("another person's waiting expenses are filtered out by the page's own member id and by the server's answer", () => {
    expect(src("src/components/offline/OfflineWaiting.tsx")).toContain("d.memberId === myId");
    expect(src("src/components/offline/OfflineSync.tsx")).toContain("serverMe.current[d.groupId] === d.memberId");
  });
  it("the route says who is asking before it looks at the group", () => {
    const r = src("src/app/api/offline/add/route.ts");
    expect(r.indexOf("if (!me)")).toBeGreaterThan(0);
    expect(r.indexOf("if (!me)")).toBeLessThan(r.indexOf("addExpenseChecks("));
  });
  it("the privacy page says a phone that stays offline keeps its copy until it is online or 30 days pass", () => {
    const t = src("src/app/privacy/page.tsx");
    expect(t).toContain("A phone that stays offline keeps its copy");
    expect(t).toContain("30 days pass");
  });
});
