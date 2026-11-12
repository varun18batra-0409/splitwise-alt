import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { requestLoginCode } from "@/lib/auth";
import { saveAccountPref } from "@/lib/account-notify-db";
import { allows, bothAllow, CATEGORIES, eventItem, isKnownKey, noteItem, parseAccountPrefs, setPref } from "@/lib/account-notify";

// "Notifications & email": the account's choices, how they combine with a group's own settings, and that
// an optional email obeys them while sign-in codes never do.

describe("parsing and defaults", () => {
  it("empty or broken data means everything is on", () => {
    for (const j of ["", null, undefined, "{not json", "[]", "7", '{"push":5}']) {
      expect(allows(j, "push", "payments.claimed"), String(j)).toBe(true);
      expect(allows(j, "email", "groups.added"), String(j)).toBe(true);
    }
  });
  it("only an explicit false switches something off; unknown keys and other values are ignored", () => {
    const p = parseAccountPrefs('{"push":{"payments.claimed":false,"nope":false,"expenses.added":true,"reminders.bills":0}}');
    expect(p).toEqual({ push: { "payments.claimed": false }, email: {} });
  });
  it("an item off blocks only that item", () => {
    const j = '{"push":{"payments.claimed":false}}';
    expect(allows(j, "push", "payments.claimed")).toBe(false);
    expect(allows(j, "push", "payments.recorded")).toBe(true);
    expect(allows(j, "email", "groups.added")).toBe(true); // the other channel is separate
  });
  it("a category off beats an item that is on, for every item in it", () => {
    const j = '{"push":{"payments":false,"payments.claimed":true}}';
    for (const i of CATEGORIES.find((c) => c.id === "payments")!.push) expect(allows(j, "push", i.id), i.id).toBe(false);
    expect(allows(j, "push", "expenses.added")).toBe(true);
  });
});

describe("account × group", () => {
  it("goes out only when both the account and the group allow it", () => {
    const on = "";
    const off = '{"push":{"expenses.added":false}}';
    expect(bothAllow(on, "push", "expenses.added", true)).toBe(true);
    expect(bothAllow(on, "push", "expenses.added", false)).toBe(false); // group muted
    expect(bothAllow(off, "push", "expenses.added", true)).toBe(false); // account says no
    expect(bothAllow(off, "push", "expenses.added", false)).toBe(false);
    expect(bothAllow(off, "push", "expenses.changed", true)).toBe(true); // a different item is unaffected
  });
  it("a person without an account (no choices stored) keeps today's behaviour", () => {
    expect(bothAllow(undefined, "push", "payments.recorded", true)).toBe(true);
    expect(bothAllow(undefined, "push", "payments.recorded", false)).toBe(false);
  });
});

describe("setting switches", () => {
  it("writes only what is off, and goes back to empty when everything is on", () => {
    let j = setPref("", "push", "payments", false);
    expect(j).toBe('{"push":{"payments":false}}');
    j = setPref(j, "email", "groups.added", false);
    expect(JSON.parse(j)).toEqual({ push: { payments: false }, email: { "groups.added": false } });
    j = setPref(j, "push", "payments", true);
    expect(j).toBe('{"email":{"groups.added":false}}');
    expect(setPref(j, "email", "groups.added", true)).toBe("");
    expect(setPref("", "push", "payments", true)).toBe("");
  });
  it("only real switches are accepted", () => {
    expect(isKnownKey("push", "payments")).toBe(true);
    expect(isKnownKey("push", "payments.claimed")).toBe(true);
    expect(isKnownKey("email", "groups.added")).toBe(true);
    expect(isKnownKey("email", "payments.claimed")).toBe(false); // Loopin sends no such email
    expect(isKnownKey("email", "payments")).toBe(false);
    expect(isKnownKey("push", "__proto__")).toBe(false);
    expect(isKnownKey("sms" as "push", "payments")).toBe(false);
  });
  it("every item is listed once and belongs to its own category", () => {
    const seen = new Set<string>();
    for (const c of CATEGORIES)
      for (const ch of ["push", "email"] as const)
        for (const i of c[ch]) {
          expect(i.id.startsWith(`${c.id}.`), i.id).toBe(true);
          expect(seen.has(`${ch}:${i.id}`), i.id).toBe(false);
          seen.add(`${ch}:${i.id}`);
        }
  });
});

describe("what each message is filed under", () => {
  it("group events", () => {
    expect(eventItem("expense_added")).toBe("expenses.added");
    for (const k of ["expense_edited", "expense_deleted", "expense_restored", "bill_added", "bill_changed", "split_changed"]) expect(eventItem(k), k).toBe("expenses.changed");
    expect(eventItem("payment_recorded")).toBe("payments.recorded");
    expect(eventItem("payment_deleted")).toBe("payments.recorded");
    expect(eventItem("payment_confirmed")).toBe("payments.answered");
    expect(eventItem("payment_claimed")).toBe("payments.claimed");
    for (const k of ["members_added", "member_invited", "members_removed", "member_left", "member_rejoined"]) expect(eventItem(k), k).toBe("groups.people");
    expect(eventItem("pot_started")).toBe("groups.games");
    for (const k of ["group_closed", "group_deleted", "currency_changed", "group_renamed"]) expect(eventItem(k), k).toBe("groups.changes");
  });
  it("personal notes", () => {
    expect(noteItem("collect_added")).toBe("payments.collect");
    expect(noteItem("collect_ticked")).toBe("payments.collect");
    expect(noteItem("group_invite")).toBe("groups.added");
    expect(noteItem("postcard")).toBe("memories.postcards");
    expect(noteItem("passport")).toBe("memories.passport");
    expect(noteItem("passport_mark")).toBe("memories.passport");
  });
  it("every item that exists as a switch is reachable from some message", () => {
    // (the push senders name their items directly; these are the ones decided by a kind)
    const viaKind = new Set([eventItem("expense_added"), eventItem("expense_edited"), eventItem("payment_recorded"), eventItem("payment_confirmed"), eventItem("payment_claimed"), eventItem("members_added"), eventItem("pot_started"), eventItem("group_closed"), noteItem("collect_added"), noteItem("group_invite"), noteItem("postcard"), noteItem("passport")]);
    for (const id of viaKind) expect(isKnownKey("push", id), id).toBe(true);
  });
});

// --- Email, through the real sendMail in test (outbox) mode ---

const stamp = Date.now();
const mail = (n: string) => `${n}-${stamp}@example.com`;
const saved = { ...process.env };
beforeAll(async () => {
  process.env.MAIL_OUTBOX = "1";
  delete process.env.VERCEL;
  await db.account.create({ data: { email: mail("quiet"), name: "Quiet", notifyPrefs: '{"email":{"groups.added":false}}' } });
  await db.account.create({ data: { email: mail("loud"), name: "Loud" } });
  await db.account.create({ data: { email: mail("alloff"), name: "AllOff", notifyPrefs: '{"push":{"payments":false},"email":{"groups":false,"groups.added":false}}' } });
});
afterEach(() => {
  process.env.MAIL_OUTBOX = "1";
});
afterAll(async () => {
  process.env = { ...saved };
  await db.account.deleteMany({ where: { email: { contains: String(stamp) } } });
  await db.outbox.deleteMany({ where: { to: { contains: String(stamp) } } });
  await db.emailOptOut.deleteMany({ where: { email: { contains: String(stamp) } } });
  await db.rateLimit.deleteMany({ where: { key: { contains: String(stamp) } } });
});

const added = (to: string) => sendMail(to, "Asha added you to Goa on Loopin", "Join here", "<p>Join</p>", { optOut: true, item: "groups.added" });
const count = (to: string) => db.outbox.count({ where: { to } });

describe("optional email obeys the account's choices", () => {
  it("a disabled email item does not send (and looks the same to the sender)", async () => {
    expect(await added(mail("quiet"))).toBe(true);
    expect(await count(mail("quiet"))).toBe(0);
  });
  it("a disabled email category does not send either", async () => {
    expect(await added(mail("alloff"))).toBe(true);
    expect(await count(mail("alloff"))).toBe(0);
  });
  it("an account with the switch on gets it, and so does an address with no account", async () => {
    expect(await added(mail("loud"))).toBe(true);
    expect(await count(mail("loud"))).toBe(1);
    expect(await added(mail("nobody"))).toBe(true);
    expect(await count(mail("nobody"))).toBe(1);
  });
  it("is matched whatever the capital letters in the address", async () => {
    expect(await added(mail("Quiet").toUpperCase())).toBe(true);
    expect(await count(mail("Quiet").toUpperCase())).toBe(0);
  });
  it("an unsubscribed address gets nothing, even with the switch on", async () => {
    await db.emailOptOut.create({ data: { email: mail("loud") } });
    expect(await added(mail("loud"))).toBe(true);
    expect(await count(mail("loud"))).toBe(1); // still just the earlier one
  });
  it("a switch saved through the server code changes the next send", async () => {
    const acc = await db.account.findUniqueOrThrow({ where: { email: mail("nobody") } }).catch(async () => db.account.create({ data: { email: mail("nobody"), name: "Nobody" } }));
    expect((await saveAccountPref(acc.id, "email", "groups.added", false)).ok).toBe(true);
    expect(await added(mail("nobody"))).toBe(true);
    expect(await count(mail("nobody"))).toBe(1); // unchanged
    expect((await saveAccountPref(acc.id, "email", "groups.added", true)).ok).toBe(true);
    expect(await added(mail("nobody"))).toBe(true);
    expect(await count(mail("nobody"))).toBe(2);
  });
});

describe("sign-in codes always send", () => {
  it("even when every email switch is off", async () => {
    const r = await requestLoginCode(mail("alloff"), "203.0.113.9", "https://example.test");
    expect(r.ok).toBe(true);
    const row = await db.outbox.findFirst({ where: { to: mail("alloff"), subject: { contains: "Loopin code" } } });
    expect(row).not.toBeNull();
  });
  it("a code email is never held back by a choice, even if one were named", async () => {
    expect(await sendMail(mail("quiet"), "123456 is your Loopin code", "123456", "<p>123456</p>", { signInCode: true, item: "groups.added" })).toBe(true);
    expect(await count(mail("quiet"))).toBe(1);
  });
});

describe("saving a switch", () => {
  it("is safe to repeat, and two switches saved at once both stick", async () => {
    const acc = await db.account.create({ data: { email: mail("racer"), name: "Racer" } });
    const results = await Promise.all([
      saveAccountPref(acc.id, "push", "payments", false),
      saveAccountPref(acc.id, "push", "payments", false), // a double tap
      saveAccountPref(acc.id, "email", "groups.added", false),
      saveAccountPref(acc.id, "push", "reminders.bills", false),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    const after = await db.account.findUniqueOrThrow({ where: { id: acc.id } });
    expect(parseAccountPrefs(after.notifyPrefs)).toEqual({ push: { payments: false, "reminders.bills": false }, email: { "groups.added": false } });
  });
  it("refuses a switch that doesn't exist and a missing account", async () => {
    const acc = await db.account.findUniqueOrThrow({ where: { email: mail("racer") } });
    expect((await saveAccountPref(acc.id, "push", "made.up", false)).ok).toBe(false);
    expect((await saveAccountPref("no-such-account", "push", "payments", false)).ok).toBe(false);
  });
});
