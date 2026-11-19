import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { netBalances } from "@/lib/balances";
import { smartSettle } from "@/lib/settle";
import { pickAdmin as appPickAdmin } from "@/lib/group-admin";
import { SELF_ACTION_KINDS as APP_KINDS, REPEAT_BILL_MARK as APP_REPEAT, PAY_LINK_MARK as APP_PAYLINK } from "@/lib/membership";

// The read-only live counts (scripts/live-counts.ts), run on throwaway local database files only.
// Money is in paise; the hand-worked numbers are written out beside each group.
// The script is loaded by path so the type checker does not follow it.
/* eslint-disable @typescript-eslint/no-explicit-any */
const LC: any = await import(/* @vite-ignore */ resolve(process.cwd(), "scripts/live-counts.ts"));
const SCHEMA_TEXT = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");

let schemaSql = "";
const dirs: string[] = [];
beforeAll(() => {
  // The real tables, made from the schema file (foreign keys are declared but not enforced here, so orphans can be planted).
  schemaSql = execFileSync("npx", ["prisma", "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { encoding: "utf8", cwd: process.cwd() });
}, 180_000);
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function makeDb(): Promise<{ client: Client; url: string }> {
  const dir = mkdtempSync(join(tmpdir(), "lp-counts-"));
  dirs.push(dir);
  const url = `file:${join(dir, "t.db")}`;
  const client = createClient({ url });
  await client.execute("PRAGMA foreign_keys = OFF");
  await client.executeMultiple(schemaSql);
  return { client, url };
}

async function ins(c: Client, table: string, row: Record<string, string | number | null>) {
  const cols = Object.keys(row);
  await c.execute({ sql: `INSERT INTO "${table}" (${cols.map((x) => `"${x}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`, args: Object.values(row) });
}
const group = (c: Client, id: string, extra: Record<string, string | number | null> = {}) => ins(c, "Group", { id, name: `Group ${id}`, inviteCode: `code-${id}`, createdAt: T0, ...extra });
const member = (c: Client, id: string, groupId: string, extra: Record<string, string | number | null> = {}) => ins(c, "Member", { id, name: `Name ${id}`, groupId, createdAt: T0, ...extra });
const expense = async (c: Client, id: string, groupId: string, paidById: string, amount: number, shares: Record<string, number>, extra: Record<string, string | number | null> = {}) => {
  await ins(c, "Expense", { id, groupId, description: `Item ${id}`, amount, splitType: "exact", paidById, createdAt: T0 + 1000, ...extra });
  for (const [m, a] of Object.entries(shares)) await ins(c, "ExpenseShare", { id: `${id}-${m}`, expenseId: id, memberId: m, amount: a });
};
const payment = (c: Client, id: string, groupId: string, fromId: string, toId: string, amount: number, extra: Record<string, string | number | null> = {}) => ins(c, "Payment", { id, groupId, fromId, toId, amount, createdAt: T0 + 2000, ...extra });
const event = (c: Client, id: string, groupId: string, actorId: string, kind: string, text: string, extra: Record<string, string | number | null> = {}) => ins(c, "GroupEvent", { id, groupId, actorId, kind, text, createdAt: T0, ...extra });

const T0 = Date.parse("2026-11-01T00:00:00Z");
const NOW = Date.parse("2026-11-19T00:00:00Z");
const DAY = 86_400_000;

// Wraps a database so that it looks like a read-only token (the write test is refused) and records every statement sent.
function readOnly(real: Client) {
  const sent: string[] = [];
  const wrapped = {
    execute: async (s: any) => {
      sent.push(typeof s === "string" ? s : s.sql);
      return real.execute(s);
    },
    transaction: async () => {
      throw new Error("SQLITE_READONLY: attempt to write a readonly database");
    },
  } as unknown as Client;
  return { wrapped, sent };
}

describe("item 3: left with a balance (hand-worked, paise)", () => {
  async function build() {
    const { client } = await makeDb();
    // Goa: Asha, Ravi, Meera. Dinner 90000 paid by Asha, 30000 each. Meera pays Asha 30000. Meera leaves.
    //   Then Taxi 10000 paid by Ravi: Ravi 3334, Asha 3333, Meera 3333.
    //   Asha 90000-30000-3333-30000 = +26667. Ravi -30000+10000-3334 = -23334. Meera -30000+30000-3333 = -3333. Total 0.
    await group(client, "goa", { type: "trip" });
    for (const [i, n] of ["asha", "ravi", "meera"].entries()) await member(client, n, "goa", { createdAt: T0 + i });
    await client.execute({ sql: 'UPDATE "Member" SET leftAt = ? WHERE id = ?', args: [T0 + 5000, "meera"] });
    await expense(client, "dinner", "goa", "asha", 90000, { asha: 30000, ravi: 30000, meera: 30000 });
    await payment(client, "p1", "goa", "meera", "asha", 30000);
    await expense(client, "taxi", "goa", "ravi", 10000, { ravi: 3334, asha: 3333, meera: 3333 }, { createdAt: T0 + 9000 });
    // Flat: Rent 20000 paid by Zoe, 10000 each. Asha2 pays Zoe 10000 (both 0). Zoe leaves. The payment is then deleted:
    //   Zoe +10000, Asha2 -10000.
    await group(client, "flat", { type: "home" });
    await member(client, "asha2", "flat", { createdAt: T0 });
    await member(client, "zoe", "flat", { createdAt: T0 + 1, leftAt: T0 + 6000 });
    await expense(client, "rent", "flat", "zoe", 20000, { asha2: 10000, zoe: 10000 });
    await payment(client, "p2", "flat", "asha2", "zoe", 10000, { deletedAt: T0 + 8000 });
    // Tiny: Snacks 101 paid by Ann, Ann 50, Ben 51. Ben pays Ann 50. Ann +1, Ben -1. Ben has left (after everything).
    await group(client, "tiny");
    await member(client, "ann", "tiny", { createdAt: T0 });
    await member(client, "ben", "tiny", { createdAt: T0 + 1, leftAt: T0 + 20_000 });
    await expense(client, "snacks", "tiny", "ann", 101, { ann: 50, ben: 51 });
    await payment(client, "p3", "tiny", "ben", "ann", 50);
    // Control: Lunch 4000 by Kim, 2000 each. Lee pays Kim 2000: both 0. Lee has left and is not counted.
    await group(client, "ctrl");
    await member(client, "kim", "ctrl", { createdAt: T0 });
    await member(client, "lee", "ctrl", { createdAt: T0 + 1, leftAt: T0 + 20_000 });
    await expense(client, "lunch", "ctrl", "kim", 4000, { kim: 2000, lee: 2000 });
    await payment(client, "p4", "ctrl", "lee", "kim", 2000);
    return client;
  }

  it("counts the three leavers with a balance and not the one at 0", async () => {
    const client = await build();
    const text = await LC.countLeaversWithBalance(client);
    expect(text).toContain("groups: 3 | people: 3 (owe others 2, are owed 1)");
    expect(text).toContain("left on own 3, removed 0");
    expect(text).toContain("by type: home 1, trip 1, other 1");
    // Ben's 1 is within 1 paisa for each of the 2 people; Meera's 3333 and Zoe's 10000 are larger.
    expect(text).toContain("within rounding (1 or less per person in the group) 1, larger 2");
    // Meera: the taxi came after she left. Zoe: the payment was deleted after she left. Ben: nothing changed.
    expect(text).toContain("money changed after they left 2");
    expect(text).toContain("groups not adding to 0: 0 (must be 0)");
    expect(text).toContain("money pointing at a non-member: 0");
  });

  it("keeps the books straight: shares add up, each group adds to 0, and the app's settle plan clears everyone", async () => {
    // The same numbers in memory, through the app's own functions.
    const goaShares = [
      { amount: 90000, paidById: "asha", shares: [{ memberId: "asha", amount: 30000 }, { memberId: "ravi", amount: 30000 }, { memberId: "meera", amount: 30000 }] },
      { amount: 10000, paidById: "ravi", shares: [{ memberId: "ravi", amount: 3334 }, { memberId: "asha", amount: 3333 }, { memberId: "meera", amount: 3333 }] },
    ];
    for (const e of goaShares) expect(e.shares.reduce((s, x) => s + x.amount, 0)).toBe(e.amount);
    const pays = [{ fromId: "meera", toId: "asha", amount: 30000 }];
    const net = netBalances(["asha", "ravi", "meera"], goaShares, pays);
    expect(net).toEqual({ asha: 26667, ravi: -23334, meera: -3333 });
    expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0);
    const plan = smartSettle(net);
    expect([...plan].sort((a, b) => b.amount - a.amount)).toEqual([
      { from: "ravi", to: "asha", amount: 23334 },
      { from: "meera", to: "asha", amount: 3333 },
    ]);
    const after = netBalances(["asha", "ravi", "meera"], goaShares, [...pays, ...plan.map((t) => ({ fromId: t.from, toId: t.to, amount: t.amount }))]);
    expect(Object.values(after)).toEqual([0, 0, 0]);
  });

  it("flags a group whose balances do not add to 0 (9000 spent, shares of 5000 + 5000)", async () => {
    const { client } = await makeDb();
    await group(client, "bad");
    await member(client, "a", "bad", { createdAt: T0 });
    await member(client, "b", "bad", { createdAt: T0 + 1, leftAt: T0 + 5000 });
    // a +9000 - 5000 = +4000, b -5000: together -1000.
    await expense(client, "e", "bad", "a", 9000, { a: 5000, b: 5000 });
    const text = await LC.countLeaversWithBalance(client);
    expect(text).toContain("groups not adding to 0: 1 (must be 0)");
  });

  it("counts money changed after leaving when an expense was edited or deleted later (and not one edited before)", async () => {
    const { client } = await makeDb();
    // Each group: Ann pays 4000, split 2000 each; Bo leaves at T0+5000 owing 2000 (Bo: -2000, Ann: +2000).
    for (const g of ["ed", "del", "before"]) {
      await group(client, g);
      await member(client, `ann-${g}`, g, { createdAt: T0 });
      await member(client, `bo-${g}`, g, { createdAt: T0 + 1, leftAt: T0 + 5000 });
    }
    // ed: that expense is edited at T0+9000, after Bo left -> changed.
    await expense(client, "e-ed", "ed", "ann-ed", 4000, { "ann-ed": 2000, "bo-ed": 2000 }, { editedAt: T0 + 9000 });
    // del: a second expense of 600 (300 each) is deleted at T0+9000 after Bo left. The live one still leaves Bo at -2000 -> changed.
    await expense(client, "e-del1", "del", "ann-del", 4000, { "ann-del": 2000, "bo-del": 2000 });
    await expense(client, "e-del2", "del", "ann-del", 600, { "ann-del": 300, "bo-del": 300 }, { deletedAt: T0 + 9000 });
    // before: edited at T0+2000, before Bo left -> not changed.
    await expense(client, "e-bef", "before", "ann-before", 4000, { "ann-before": 2000, "bo-before": 2000 }, { editedAt: T0 + 2000 });
    const text = await LC.countLeaversWithBalance(client);
    expect(text).toContain("groups: 3 | people: 3 (owe others 3, are owed 0)");
    expect(text).toContain("money changed after they left 2");
  });
});

// One database holding a planted case for items 1, 2, 4 and 5.
async function planted() {
  const { client, url } = await makeDb();
  // ---- Item 1 (group g1; g1b has the same email but no invite there)
  await group(client, "g1");
  await group(client, "g1b");
  for (const n of ["zoya", "priya", "ravi1", "kim1", "actor1"]) await member(client, n, "g1", { createdAt: T0 });
  await member(client, "actor1b", "g1b");
  await member(client, "emailname", "g1", { name: "x@y.test", createdAt: T0 });
  const inv = (id: string, email: string, memberId: string, token: string, createdAt: number) => ins(client, "Invite", { id, groupId: "g1", email, invitedById: "actor1", memberId, token, createdAt });
  await inv("i1", "zoya@example.test", "zoya", "tok1", T0);
  await inv("i2", "priya.k@example.test", "priya", "tok2", T0);
  await inv("i3", "ravi1@example.test", "ravi1", "tok3", T0 + 50_000); // sent again after the line
  await inv("i4", "nora@example.test", "", "tok4", T0); // no name row, no dot in the token
  await inv("i5", "gina@example.test", "mGhost", "tok5", T0); // name row gone
  await inv("i6", "a1@example.test", "zoya", "tok6", T0);
  await inv("i7", "b1@example.test", "priya", "tok7", T0);
  await inv("i8", "kim1@example.test", "kim1", "tok8", T0);
  await event(client, "ev1", "g1", "actor1", "member_invited", "invited Zoya (ZOYA@Example.Test) to join", { createdAt: T0 + 1000 }); // certain, before the cutoff
  await event(client, "ev2", "g1", "actor1", "members_added", "added Priya (priya.k@example.test) to the group", { createdAt: new Date(T0 + 20_000).toISOString(), undo: JSON.stringify({ type: "members_remove", memberIds: ["priya"] }) }); // exact; date as text
  await event(client, "ev3", "g1", "actor1", "member_invited", "invited ravi1@example.test to join", { createdAt: T0 + 30_000 }); // unsure: sent again since
  await event(client, "ev4", "g1", "actor1", "member_invited", "invited nora@example.test to join", { createdAt: T0 + 31_000 }); // unsure: no name row
  await event(client, "ev5", "g1", "actor1", "member_invited", "invited gina@example.test to join", { createdAt: T0 + 32_000 }); // row gone
  await event(client, "ev6", "g1", "actor1", "expense_added", "split with a1@example.test and b1@example.test", { createdAt: T0 + 33_000 }); // several emails
  await event(client, "ev7", "g1", "actor1", "member_invited", "invited someone to join", { details: JSON.stringify(["kim1@example.test"]), createdAt: T0 + 34_000 }); // certain, email in details
  await event(client, "ev8", "g1", "actor1", "expense_added", "paid stranger@example.test", { createdAt: T0 + 35_000 }); // email-like, no invite
  await event(client, "ev9", "g1", "actor1", "expense_added", "added Dinner @ Taj (₹900)", { createdAt: T0 + 36_000 }); // not an email
  await event(client, "ev10", "g1b", "actor1b", "member_invited", "invited zoya@example.test to join", { createdAt: T0 + 37_000 }); // same email, different group: no invite there
  await event(client, "ev11", "g1", "actor1", "member_renamed", "renamed Name zoya to Zo", { createdAt: T0 + 40_000, undo: JSON.stringify({ type: "member_set", memberId: "zoya", data: { name: "Name zoya" } }) });

  // ---- Item 2: claimed but no account
  await group(client, "g2");
  await group(client, "g3");
  await group(client, "g4");
  await group(client, "g5");
  const S = T0 + 1_000_000;
  await member(client, "w1", "g2", { createdAt: T0, claimedAt: S }); // wrong: same stamp as w2
  await member(client, "r1", "g2", { createdAt: T0 + 1, claimedAt: T0 + 2_000_000, grantEpoch: 1 }); // real: deleted account
  await member(client, "w2", "g3", { createdAt: T0, claimedAt: S }); // wrong: same stamp
  await member(client, "wr", "g4", { createdAt: T0, claimedAt: T0 + 10_000_000 }); // wrong: claimed (1 Nov, inside the bug window) after its first line, which was a repeat bill
  await event(client, "ev20", "g4", "wr", "expense_added", "paid Rent (₹100) · repeat bill", { createdAt: T0 + 9_500_000 });
  await member(client, "r2", "g5", { createdAt: T0, claimedAt: T0 + 3_000_000 }); // real: phone alerts
  await ins(client, "PushSubscription", { id: "ps1", memberId: "r2", endpoint: "https://push.example.test/1", p256dh: "k", auth: "a" });
  await member(client, "r3", "g5", { createdAt: T0, claimedAt: T0 + 4_000_000 }); // real: own action
  await event(client, "ev21", "g5", "r3", "expense_added", "added Dinner (₹900)", { createdAt: T0 + 4_500_000 });
  await member(client, "r4", "g5", { createdAt: T0, claimedAt: T0 + 5_000_000, seenEventsAt: T0 + 5_100_000 }); // real: opened alerts
  await member(client, "r5", "g5", { createdAt: T0 + 6_000_000, claimedAt: T0 + 6_001_000 }); // real: claimed when created
  await member(client, "r6", "g5", { createdAt: T0, claimedAt: T0 + 7_000_000 }); // real: reacted
  await expense(client, "exp-r", "g5", "r3", 100, { r3: 100 });
  await ins(client, "Reaction", { id: "re1", expenseId: "exp-r", memberId: "r6", emoji: "x" });
  await member(client, "u1", "g5", { createdAt: T0, claimedAt: T0 + 8_000_000 }); // unsure: nothing to tell either way
  await member(client, "acc", "g5", { createdAt: T0, claimedAt: T0 + 9_000_000, accountId: "a1" }); // has an account: not a suspect
  await member(client, "pay1", "g5", { createdAt: T0 });
  await payment(client, "pw1", "g2", "pay1", "w1", 500, { needsOk: 1 }); // waiting for w1's OK
  await payment(client, "pw2", "g2", "pay1", "w1", 500, { needsOk: 1, okAt: T0 + 3000 }); // already answered
  await payment(client, "pw3", "g2", "pay1", "w1", 500, { needsOk: 1, deletedAt: T0 + 3000 }); // deleted

  // ---- Item 4: orphans
  await member(client, "mA", "g5", { createdAt: T0 });
  await member(client, "mOther", "g2", { createdAt: T0 });
  await expense(client, "e-ok", "g5", "mA", 100, { mA: 100 }, { payers: JSON.stringify([{ m: "mA", a: 100 }]) });
  await ins(client, "ExpenseShare", { id: "cross", expenseId: "e-ok", memberId: "mOther", amount: 0 }); // member of another group
  await expense(client, "e-bad", "g5", "nobody", 100, {}); // declared link: payer does not exist
  await expense(client, "e-ghost", "g5", "mA", 100, { mA: 100 }, { payers: JSON.stringify([{ m: "ghost", a: 100 }]) }); // payers list names nobody
  await expense(client, "e-json", "g5", "mA", 100, { mA: 100 }, { payers: "{bad" }); // not valid JSON
  await ins(client, "PotGame", { id: "pot1", groupId: "g5", name: "Game", hostId: "ghost", players: JSON.stringify(["ghost"]) });
  await event(client, "ev30", "g5", "gone", "expense_added", "added Thing (₹1)"); // expected after deletions
  await event(client, "ev31", "g5", "mA", "payment_recorded", "recorded", { paymentId: "claim:zzz" }); // claim row missing
  await ins(client, "Invite", { id: "i9", groupId: "g5", email: "late@example.test", invitedById: "ghost", memberId: "mA", token: "tok9" });

  // ---- Item 5: PaymentClaim
  await group(client, "g6");
  await group(client, "g7", { closed: 1 });
  await member(client, "c1", "g6");
  await member(client, "c2", "g6");
  await member(client, "c3", "g6", { leftAt: T0 });
  await member(client, "c4", "g7");
  await member(client, "c5", "g7");
  const claim = (id: string, g: string, from: string, to: string, status: string, ageDays: number, extra: Record<string, string | number | null> = {}) =>
    ins(client, "PaymentClaim", { id, groupId: g, fromId: from, toId: to, amount: 100, slot: id, status, createdAt: NOW - ageDays * DAY, ...extra });
  await claim("k1", "g6", "c1", "c2", "waiting", 10);
  await claim("k2", "g6", "c2", "c1", "waiting", 60);
  await claim("k3", "g7", "c4", "c5", "waiting", 120);
  await claim("k4", "g6", "c1", "c2", "waiting", 5, { currency: "USD" });
  await claim("k5", "g6", "c1", "c3", "waiting", 5);
  await claim("k6", "g6", "c1", "c2", "confirmed", 50);
  await payment(client, "pay-live", "g6", "c1", "c2", 100);
  await claim("k7", "g6", "c2", "c1", "covered", 50, { paymentId: "pay-live" });
  await claim("k8", "g6", "c2", "c1", "covered", 50, { paymentId: "pay-missing" });
  await claim("k9", "g6", "c1", "c2", "declined", 50);
  return { client, url };
}

describe("items 1, 2, 4 and 5 on planted rows", () => {
  it("item 1: counts the lines that show an invited person's email, once each, and leaves 'Dinner @ Taj' alone", async () => {
    const { client } = await planted();
    const text = await LC.countEmailsInHistory(client, T0 + 10_000);
    // Lines: ev1, ev2, ev3, ev4, ev5, ev6, ev7 = 7. Before the cutoff: ev1. After: 6.
    expect(text).toContain("lines with an invite's email: 7 (before cutoff 1, after 6)");
    expect(text).toContain("member_invited 5, members_added 1, other 1");
    // ev2 exact; ev1 and ev7 certain; ev3 sent again; ev4 no name row; ev5 row gone; ev6 two emails. 1+2+1+1+1+1 = 7.
    expect(text).toContain("exact 1, certain 2, unsure-resent 1, unsure-no-row 1, row gone 1, several emails 1");
    expect(text).toContain("renamed since 1"); // ev1's person was renamed afterwards
    expect(text).toContain("email-like but no invite 2"); // ev8 and the other group's line
    expect(text).toContain("details field 1");
    expect(text).toContain("name rows that are an email 1");
  });

  it("item 1: an email must match as a whole word (a@x.test is not inside ana@x.test)", async () => {
    const { client } = await makeDb();
    await group(client, "wt");
    await member(client, "m1", "wt");
    await ins(client, "Invite", { id: "iw", groupId: "wt", email: "a@x.test", invitedById: "m1", memberId: "m1", token: "tw", createdAt: T0 });
    await event(client, "w1", "wt", "m1", "member_invited", "invited ana@x.test to join", { createdAt: T0 + 1000 }); // longer address: no
    await event(client, "w2", "wt", "m1", "member_invited", "invited a@x.test. Done", { createdAt: T0 + 2000 }); // yes (full stop after)
    await event(client, "w3", "wt", "m1", "member_invited", "invited (A@x.test) now", { createdAt: T0 + 3000 }); // yes (brackets)
    await event(client, "w4", "wt", "m1", "member_invited", "invited a@x.test.uk to join", { createdAt: T0 + 4000 }); // longer address: no
    const text = await LC.countEmailsInHistory(client, T0);
    expect(text).toContain("lines with an invite's email: 2 ");
    expect(text).toContain("email-like but no invite 2");
    expect(LC.hasToken("xa@x.test", "a@x.test")).toBe(false);
    expect(LC.hasToken("a@x.test", "a@x.test")).toBe(true);
  });

  it("item 2: sorts the claimed-but-no-account names into real, wrong and unsure", async () => {
    const { client } = await planted();
    const text = await LC.countWrongJoined(client);
    // Suspects: w1 w2 wr r1 r2 r3 r4 r5 r6 u1 = 10 (the one with an account is not one).
    expect(text).toContain("claimed but no account: 10");
    expect(text).toContain("certainly real 6 (deleted account 1, phone alerts 1, own actions 1, opened alerts 1, claimed when created 1, reactions 1)");
    // Wrong: w1 and w2 (same stamp), wr (claimed after a repeat-bill line, which is not an action of theirs). All claimed inside the bug window (15 Oct to 16 Nov 2026).
    expect(text).toContain("certainly wrong 3 (same-stamp groups 1, largest 2, in a burst 0)");
    expect(text).toContain("unsure 1");
    expect(text).toContain("still waiting for OK: 1");
    // g2: w1 is the admin today (claimed, oldest); with its stamp cleared r1 (claimed, real) takes over. g3 and g4 have one person each.
    expect(text).toContain("groups whose admin would change: 1");
  });

  it("item 2: a late claim from before the bug window is unsure, not wrong (the same shape inside the window is wrong)", async () => {
    const { client } = await makeDb();
    await group(client, "pre");
    const before = Date.parse("2026-09-01T00:00:00Z");
    await member(client, "old1", "pre", { createdAt: before - 100_000, claimedAt: before + 50_000 });
    await event(client, "ev-pre", "pre", "old1", "expense_added", "paid Rent (₹100) · repeat bill", { createdAt: before });
    const text = await LC.countWrongJoined(client);
    expect(text).toContain("claimed but no account: 1");
    expect(text).toContain("certainly wrong 0");
    expect(text).toContain("unsure 1");
  });

  it("item 2: three stamps within two minutes across two groups are a burst", async () => {
    const { client } = await makeDb();
    await group(client, "b1");
    await group(client, "b2");
    await member(client, "x1", "b1", { claimedAt: T0 + 500_000 });
    await member(client, "x2", "b1", { claimedAt: T0 + 530_000 });
    await member(client, "x3", "b2", { claimedAt: T0 + 560_000 });
    const text = await LC.countWrongJoined(client);
    expect(text).toContain("certainly wrong 3 (same-stamp groups 0, largest 0, in a burst 3)");
  });

  it("item 4: finds each planted orphan exactly once and not the healthy rows", async () => {
    const { client } = await planted();
    const [declared, money, expected] = await LC.countOrphans(client, SCHEMA_TEXT);
    expect(declared).toContain("(Expense.paidById 1)");
    expect(money).toContain("Expense.payers 1 (not valid JSON 1)");
    expect(money).toContain("PotGame.hostId 1");
    expect(money).toContain("PotGame.players 1");
    expect(money).toContain("PaymentClaim.paymentId 1");
    expect(money).toContain("ExpenseShare member in another group 1");
    expect(money).toContain("Expense payer in another group 0");
    expect(expected).toContain("GroupEvent.actorId 1");
    expect(expected).toContain("GroupEvent.paymentId 1");
    expect(expected).toContain("Invite.invitedById 1");
    expect(expected).toContain("Member.accountId 1");
  });

  it("item 5: counts the old I've-paid notes", async () => {
    const { client } = await planted();
    const text = await LC.countClaims(client, NOW);
    expect(text).toContain("waiting 5, confirmed 1, declined 1, withdrawn 0, covered 2, expired 0");
    expect(text).toContain("<30d 3, 30–90d 1, >90d 1"); // k1 k4 k5 / k2 / k3
    expect(text).toContain("waiting in gone/closed groups 1"); // k3
    expect(text).toContain("another currency than the group's 1"); // k4
    expect(text).toContain("a person missing or left 1"); // k5
    expect(text).toContain("covered pointing at a missing payment 1"); // k8
  });

  it("prints counts only: no planted email, name or id appears, and nothing was written", async () => {
    const { client } = await planted();
    const { wrapped, sent } = readOnly(client);
    const out: string[] = [];
    const code = await LC.run({ env: { TURSO_DATABASE_URL: "file:ignored", CUTOFF: "2026-11-11T21:06:07Z" }, client: wrapped, write: (s: string) => out.push(s), summaryFile: "" });
    expect(code).toBe(0);
    const all = out.join("\n");
    expect(all).toContain("::notice title=1 · Emails in history::");
    expect(all).toContain("::notice title=5 · Old I've-paid notes::");
    expect(all).not.toContain("withheld");
    expect(all).not.toContain("Failed");
    // Every email, name and id planted above.
    const secrets = ["example.test", "x@y.test", "ZOYA", "zoya", "priya", "name zoya", "name w1", "group g", "stranger", "mGhost", "ghost", "tok", "push.example", "code-g", "pay-live", "pay-missing", "e-ok", "e-bad", "ev1", "cross", "nobody"];
    for (const s of secrets) expect(all.toLowerCase(), `output must not contain ${s}`).not.toContain(s.toLowerCase());
    expect(all).not.toMatch(/[A-Za-z0-9]{20,}/);
    expect(all).not.toContain("@");
    // Notice titles are split on commas by GitHub, so none may hold one.
    for (const l of out.filter((x) => x.startsWith("::notice title="))) expect(l.slice("::notice title=".length, l.indexOf("::", 10))).not.toContain(",");
    // Only reading was sent to the database.
    expect(sent.length).toBeGreaterThan(20);
    for (const sql of sent) expect(sql.trim()).toMatch(/^(SELECT|PRAGMA foreign_key_check)/);
  });
});

describe("the read-only guard", () => {
  const fake = (message: string) => ({ transaction: async () => { throw new Error(message); } }) as unknown as Client;
  const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

  it("refuses a writable local file (exit 1) and leaves AppSetting unchanged", async () => {
    const { client, url } = await makeDb();
    await ins(client, "AppSetting", { key: "k", value: "v" });
    const out: string[] = [];
    const code = await LC.run({ env: { TURSO_DATABASE_URL: url }, write: (s: string) => out.push(s), summaryFile: "" });
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("REFUSING: this token can write");
    expect(out.join("\n")).not.toContain("::notice");
    const rows = (await client.execute("SELECT key, value FROM AppSetting")).rows;
    expect(rows.map((r) => [r.key, r.value])).toEqual([["k", "v"]]);
  });

  it("passes a client that refuses writes (SQLITE_READONLY)", async () => {
    await expect(LC.guardReadOnly(fake("SQLITE_READONLY: attempt to write a readonly database"), "")).resolves.toBeUndefined();
  });

  it("refuses when the refusal is not recognised (a network error)", async () => {
    await expect(LC.guardReadOnly(fake("fetch failed"), "")).rejects.toThrow(/could not prove/);
  });

  it("refuses when the answer is an auth failure (401, 403, unauthorized, forbidden): that does not prove read-only", async () => {
    for (const m of ["Server returned HTTP status 401", "HTTP status 403", "Unauthorized", "Forbidden", "401 Unauthorized: not allowed to write"])
      await expect(LC.guardReadOnly(fake(m), ""), m).rejects.toThrow(/could not prove/);
  });

  it("accepts each clear read-only refusal", async () => {
    for (const m of ["database is readonly", "this is a read only token", "read-only transaction", "You are not allowed to write", "SQLITE_READONLY", "attempt to write a readonly database"])
      await expect(LC.guardReadOnly(fake(m), ""), m).resolves.toBeUndefined();
  });

  it("refuses a remote address with an empty token, before connecting", async () => {
    const out: string[] = [];
    for (const token of [undefined, ""]) {
      expect(await LC.run({ env: { TURSO_DATABASE_URL: "libsql://example-db.turso.io", TURSO_AUTH_TOKEN: token }, write: (s: string) => out.push(s), summaryFile: "" })).toBe(1);
    }
    expect(out.every((l) => l.startsWith("REFUSING") && l.includes("TURSO_AUTH_TOKEN is empty"))).toBe(true);
  });

  it("closes a client it made itself (not one it was given)", async () => {
    const { url } = await makeDb(); // a writable file: it refuses, and the client it opened must still be closed
    const out: string[] = [];
    expect(await LC.run({ env: { TURSO_DATABASE_URL: url }, write: (s: string) => out.push(s), summaryFile: "" })).toBe(1);
    const src = readFileSync(resolve(process.cwd(), "scripts/live-counts.ts"), "utf8");
    expect(src).toMatch(/finally \{\s+try \{\s+created\?\.close\(\)/);
  });

  it("refuses a token that says it is not read-only, without trying anything", async () => {
    let tried = false;
    const spy = { transaction: async () => { tried = true; throw new Error("SQLITE_READONLY"); } } as unknown as Client;
    await expect(LC.guardReadOnly(spy, jwt({ a: "rw" }))).rejects.toThrow(/not read-only/);
    expect(tried).toBe(false);
    await expect(LC.guardReadOnly(spy, jwt({ a: "ro" }))).resolves.toBeUndefined();
    await expect(LC.guardReadOnly(spy, jwt({ id: "no-claim" }))).resolves.toBeUndefined(); // no claim: the write test decides
  });

  it("refuses when the address is missing, the branch is wrong or the cutoff is not a date", async () => {
    const out: string[] = [];
    const w = (s: string) => out.push(s);
    expect(await LC.run({ env: {}, write: w, summaryFile: "" })).toBe(1);
    expect(await LC.run({ env: { TURSO_DATABASE_URL: "file:x", GITHUB_ACTIONS: "true", GITHUB_REF_NAME: "ops-live-counts-dev" }, write: w, summaryFile: "" })).toBe(1);
    expect(await LC.run({ env: { TURSO_DATABASE_URL: "file:x", GITHUB_ACTIONS: "true", GITHUB_REF_NAME: "main" }, write: w, summaryFile: "" })).toBe(1);
    // The public repo never reads live, even on the old live-counts branch name.
    const pub = "Varun18Batra-0409/splitwise-alt";
    expect(await LC.run({ env: { TURSO_DATABASE_URL: "file:x", GITHUB_ACTIONS: "true", GITHUB_REF_NAME: "ops-live-counts", GITHUB_REPOSITORY: pub }, write: w, summaryFile: "" })).toBe(1);
    expect(await LC.run({ env: { TURSO_DATABASE_URL: "file:x", GITHUB_ACTIONS: "true", GITHUB_REF_NAME: "main", GITHUB_REPOSITORY: "" }, write: w, summaryFile: "" })).toBe(1);
    expect(await LC.run({ env: { TURSO_DATABASE_URL: "file:x", CUTOFF: "not a date" }, write: w, summaryFile: "" })).toBe(1);
    expect(out.every((l) => l.startsWith("REFUSING"))).toBe(true);
  });
});

describe("the output filter and small rules", () => {
  it("withholds an email, an id-like run, or odd characters", () => {
    expect(LC.safeLine("a@b.test")).toBe("(line withheld)");
    expect(LC.safeLine("id abcdefghij0123456789")).toBe("(line withheld)");
    expect(LC.safeLine("name <script>")).toBe("name <script>");
    expect(LC.safeLine("emoji 🎉")).toBe("(line withheld)");
    expect(LC.safeLine("3 · Left with a balance: groups: 3 | people: 3 (owe others 2) ≤ 1")).toContain("groups: 3");
  });

  it("reads dates stored as numbers or as text", () => {
    const ms = Date.parse("2026-11-01T00:00:00Z");
    expect(LC.toMs(ms)).toBe(ms);
    expect(LC.toMs(String(ms))).toBe(ms);
    expect(LC.toMs("2026-11-01T00:00:00.000Z")).toBe(ms);
    expect(LC.toMs("2026-11-01 00:00:00")).toBe(ms);
    expect(LC.toMs(null)).toBeNull();
  });

  it("copies of the app's rules match the app", () => {
    expect(LC.SELF_ACTION_KINDS).toEqual(APP_KINDS);
    expect(LC.REPEAT_BILL_MARK).toBe(APP_REPEAT);
    expect(LC.PAY_LINK_MARK).toBe(APP_PAYLINK);
    const d = (n: number) => new Date(T0 + n);
    const samples = [
      [{ id: "a", claimedAt: d(1), leftAt: null }, { id: "b", claimedAt: d(2), leftAt: null }],
      [{ id: "a", claimedAt: d(1), leftAt: d(5) }, { id: "b", claimedAt: d(2), leftAt: null }],
      [{ id: "a", claimedAt: null, leftAt: null }, { id: "b", claimedAt: d(2), leftAt: null }],
      [{ id: "a", claimedAt: null, leftAt: null, addedBy: "x", seenAt: null }, { id: "b", claimedAt: null, leftAt: null }],
      [{ id: "a", claimedAt: d(1), leftAt: d(1) }, { id: "b", claimedAt: null, leftAt: d(1) }],
      [],
    ];
    for (const s of samples) expect(LC.pickAdmin(s)?.id).toBe(appPickAdmin(s)?.id);
    // The invitation's name row rule: the source says exactly this.
    const src = readFileSync(resolve(process.cwd(), "src/lib/invites.ts"), "utf8");
    expect(src).toContain('export const memberOfToken = (token: string) => (token.includes(".") ? token.split(".")[0] : "");');
    expect(src).toContain("export const inviteMemberId = (inv: { memberId: string; token: string }) => inv.memberId || memberOfToken(inv.token);");
    expect(LC.inviteMemberId({ memberId: "m", token: "x.y" })).toBe("m");
    expect(LC.inviteMemberId({ memberId: "", token: "m1.rest" })).toBe("m1");
    expect(LC.inviteMemberId({ memberId: "", token: "random" })).toBe("");
  });

  it("reads the declared links from the schema file", () => {
    const models = LC.readSchema(SCHEMA_TEXT);
    expect(models.get("Expense").links).toContainEqual({ col: "paidById", target: "Member", ref: "id" });
    expect(models.get("ExpenseShare").links.map((l: { col: string }) => l.col).sort()).toEqual(["expenseId", "memberId"]);
    expect(models.get("Member").cols.has("claimedAt")).toBe(true);
  });

  it("in GitHub it runs in the private ops repo, or on the practice branch of the public repo", async () => {
    const { client } = await makeDb();
    const { wrapped } = readOnly(client);
    for (const env of [
      { GITHUB_REPOSITORY: "someone/loopin-ops", GITHUB_REF_NAME: "main" },
      { GITHUB_REPOSITORY: "varun18batra-0409/splitwise-alt", GITHUB_REF_NAME: "ops-live-counts-staging" },
    ]) {
      const out: string[] = [];
      await LC.run({ env: { TURSO_DATABASE_URL: "file:x", GITHUB_ACTIONS: "true", ...env }, client: wrapped, write: (s: string) => out.push(s), summaryFile: "" });
      expect(out[0], JSON.stringify(env)).toBe("Read-only check passed. Counting.");
    }
  });

  it("the script can only read: no database client calls, and the only write words are the rolled-back test", () => {
    const src = readFileSync(resolve(process.cwd(), "scripts/live-counts.ts"), "utf8");
    const code = src.split("\n").map((l) => l.replace(/\s\/\/ .*$/, "")).filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/\bdb\.(\w+)\.(create|update|delete|upsert)/);
    expect(code).not.toMatch(/\b(INSERT|DELETE|CREATE|DROP|ALTER|REPLACE|VACUUM|ATTACH)\b/);
    expect(code.match(/\bUPDATE\b/g)).toHaveLength(1);
    expect(code).toContain('"UPDATE AppSetting SET value = value WHERE 0"');
    expect(code).not.toMatch(/\.batch\(|executeMultiple|\.migrate\(/);
    expect(code).not.toContain("console.error");
  });
});
