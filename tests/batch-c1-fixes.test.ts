import { afterAll, describe, expect, it, vi } from "vitest";

// Batch C part 1: the audit fixes. Every account, email and group below is made fresh for its own test.
// Money is in paise. The numbers are worked out by hand in each test.
// (The sections about "I've paid" notes are gone: nothing waits for anyone any more, see tests/counts-at-once.test.ts.)
//
// The shared cast: Asha (A), Ravi (R), Meera (M), all joined.

const state = vi.hoisted(() => ({ cookie: "", pushes: [] as { ids: string[]; p: { title: string; body: string; url: string; tag: string } }[], tasks: [] as Promise<unknown>[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test", "x-forwarded-for": `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  RedirectType: { replace: "replace", push: "push" },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
// `after` runs its job (and the test waits for it), so the pushes a request would send can be seen.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (job: () => Promise<unknown>) => void state.tasks.push(Promise.resolve().then(job)) }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("@/lib/push", async (orig) => ({
  ...(await orig<typeof import("@/lib/push")>()),
  sendPushTo: async (ids: string[], p: { title: string; body: string; url: string; tag: string }) => {
    state.pushes.push({ ids, p });
    return 1;
  },
}));

process.env.MAIL_OUTBOX = "1";
const { db } = await import("@/lib/db");
const { encodeSession, today } = await import("@/lib/session");
const { eraseGroups } = await import("@/lib/purge");
const { netBalances } = await import("@/lib/balances");
const { createPayment } = await import("@/lib/payments");
const { setPaymentsDeleted } = await import("@/lib/settle-all");
const { payLinkFor, readPayLink, recordLinkPayment, owedInTx } = await import("@/lib/pay-link");
const { addRegistered, inviteToClaim, searchPeople } = await import("@/lib/invites");
const { overpayHref, differentAmountHref } = await import("@/lib/money");
const { joinNew, NAME_NEEDED } = await import("@/lib/join");
const { readFileSync } = await import("node:fs");
const A = await import("@/app/actions");
const L = await import("@/app/pay-link-actions");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let counter = 0;
const groups: string[] = [];
const accounts: string[] = [];
afterAll(async () => {
  state.cookie = "";
  await eraseGroups(groups);
  await db.account.deleteMany({ where: { id: { in: accounts } } }).catch(() => undefined);
});

const sum = (n: Record<string, number>) => Object.values(n).reduce((x, y) => x + y, 0);
async function net(gid: string) {
  const members = await db.member.findMany({ where: { groupId: gid }, select: { id: true } });
  const [expenses, payments] = await Promise.all([
    db.expense.findMany({ where: { groupId: gid, deletedAt: null }, include: { shares: true } }),
    db.payment.findMany({ where: { groupId: gid, deletedAt: null } }),
  ]);
  return netBalances(members.map((x) => x.id), expenses, payments);
}
const payCount = (gid: string) => db.payment.count({ where: { groupId: gid, deletedAt: null } });

type Share = [string, number][];
async function addExpense(gid: string, paidById: string, amount: number, shares: Share, description = "Spend") {
  return db.expense.create({
    data: { groupId: gid, description, amount, splitType: "equal", paidById, createdById: paidById, originalAmount: amount, convertedAmount: amount, shares: { create: shares.map(([memberId, a]) => ({ memberId, amount: a })) } },
  });
}

// Asha, Ravi, Meera. `joined: false` leaves Asha as only a name (no account).
async function world(o: { ashaJoined?: boolean; currency?: string } = {}) {
  const n = ++counter;
  const g = await db.group.create({
    data: {
      name: `C1 ${n} ${stamp}`,
      currency: o.currency ?? "INR",
      inviteCode: `c1-${n}-${stamp}`,
      members: { create: [{ name: "Asha", ...(o.ashaJoined === false ? {} : { claimedAt: new Date() }) }, { name: "Ravi", claimedAt: new Date() }, { name: "Meera", claimedAt: new Date() }] },
    },
    include: { members: true },
  });
  groups.push(g.id);
  const id = (nm: string) => g.members.find((m) => m.name === nm)!.id;
  return { gid: g.id, a: id("Asha"), r: id("Ravi"), m: id("Meera") };
}
type W = Awaited<ReturnType<typeof world>>;
const as = async (w: W, memberId: string) => {
  state.cookie = await encodeSession({ m: { [w.gid]: memberId }, t: today() });
};
async function redirectOf(fn: () => Promise<unknown>): Promise<URL> {
  try {
    await fn();
  } catch (err) {
    const m = /^NEXT_REDIRECT (.*)$/.exec(String((err as Error)?.message));
    if (!m) throw err;
    return new URL(m[1], "http://loopin.test");
  }
  throw new Error("expected a redirect");
}
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
// The auditor's story: Dinner ₹600 paid by Asha for Asha and Ravi (300 each); Cab ₹300 paid by Meera for Ravi.
//   Asha +60000 −30000 = +30000.  Ravi −30000 −30000 = −60000.  Meera +30000.  (sum 0)
//   Settle up: Ravi → Asha 30000 and Ravi → Meera 30000.
async function auditorWorld() {
  const w = await world();
  await addExpense(w.gid, w.a, 60000, [[w.a, 30000], [w.r, 30000]], "Dinner");
  await addExpense(w.gid, w.m, 30000, [[w.r, 30000]], "Cab");
  expect(await net(w.gid)).toEqual({ [w.a]: 30000, [w.r]: -60000, [w.m]: 30000 });
  return w;
}


describe("1: restoring a payment twice changes nothing the second time", () => {
  it("restoring twice changes nothing the second time", async () => {
    const w = await auditorWorld();
    const p = await db.$transaction((tx) => createPayment(tx, { groupId: w.gid, fromId: w.r, toId: w.a, amount: 30000, createdById: w.m }));
    await setPaymentsDeleted(w.gid, w.a, [p.id], true);
    await setPaymentsDeleted(w.gid, w.a, [p.id], false);
    await setPaymentsDeleted(w.gid, w.a, [p.id], false);
    expect(await payCount(w.gid)).toBe(1);
    expect(await net(w.gid)).toEqual({ [w.a]: 0, [w.r]: -30000, [w.m]: 30000 });
  });
});

describe("2 and 3: adding from search and the history line never use the start of an email", () => {
  async function account(label: string, name: string) {
    const n = ++counter;
    const a = await db.account.create({ data: { email: `c1-${label}-${n}-${stamp}@example.test`, name } });
    accounts.push(a.id);
    return a;
  }

  it("a nameless account added from search gets the name the search showed (their name in the shared group)", async () => {
    const me = await account("me", "Chandler");
    const nameless = await account("secretlocal", "");
    // An older group we share: she is "Tinku" there.
    const old = await db.group.create({
      data: { name: `Old ${stamp}-${counter}`, currency: "INR", inviteCode: `c1-old-${counter}-${stamp}`, members: { create: [{ name: "Chandler", accountId: me.id, claimedAt: new Date() }, { name: "Tinku", accountId: nameless.id, claimedAt: new Date() }] } },
      include: { members: true },
    });
    const fresh = await db.group.create({
      data: { name: `Fresh ${stamp}-${counter}`, currency: "INR", inviteCode: `c1-fresh-${counter}-${stamp}`, members: { create: [{ name: "Chandler", accountId: me.id, claimedAt: new Date() }] } },
      include: { members: true },
    });
    groups.push(old.id, fresh.id);
    const meOld = old.members.find((m) => m.name === "Chandler")!.id;
    const meFresh = fresh.members[0].id;
    const found = await searchPeople({ [old.id]: meOld, [fresh.id]: meFresh }, fresh.id, "tink");
    expect(found.map((f) => f.name)).toEqual(["Tinku"]);
    const added = await addRegistered(fresh.id, meFresh, nameless.id, "https://loopin.test");
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.name).toBe("Tinku"); // never "C1-secretlocal-…" from the email
    const row = await db.member.findUniqueOrThrow({ where: { id: added.memberId } });
    expect(row.name).toBe("Tinku");
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: fresh.id, kind: "members_added" } });
    expect(ev.text).toBe("added Tinku to the group");
  });

  it("an account with its own name keeps it", async () => {
    const me = await account("me2", "Chandler");
    const joey = await account("joeymail", "Joey");
    const g = await db.group.create({
      data: { name: `Named ${stamp}-${counter}`, currency: "INR", inviteCode: `c1-named-${counter}-${stamp}`, members: { create: [{ name: "Chandler", accountId: me.id, claimedAt: new Date() }] } },
      include: { members: true },
    });
    // Joey and Chandler share an older group (since 16 Nov only people you share a group with can be added from search).
    const older = await db.group.create({
      data: { name: `Named older ${stamp}-${counter}`, currency: "INR", inviteCode: `c1-namedold-${counter}-${stamp}`, members: { create: [{ name: "Chandler", accountId: me.id, claimedAt: new Date() }, { name: "Joey", accountId: joey.id, claimedAt: new Date() }] } },
    });
    groups.push(g.id, older.id);
    const added = await addRegistered(g.id, g.members[0].id, joey.id, "https://loopin.test");
    expect(added.ok && added.name).toBe("Joey");
  });

  it("the history line for 'invite by email' for a name-only person shows no email address", async () => {
    const w = await world();
    const named = await db.member.create({ data: { groupId: w.gid, name: "Zoya" } });
    const email = `c1-zoya-${++counter}-${stamp}@example.test`;
    const r = await inviteToClaim(w.gid, w.a, named.id, email, "https://loopin.test");
    expect(r.ok).toBe(true);
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: w.gid, kind: "member_invited" } });
    expect(ev.text).toBe("invited Zoya to join");
    expect(ev.text).not.toContain("@");
    expect(ev.text).not.toContain(email);
  });
});

describe("4: the pay link records a payment right away, for everyone", () => {
  it("name-only Asha: the link records the payment once and it counts now (no flag, no note)", async () => {
    // Dinner ₹900 paid by Asha: A +60000, R −30000, M −30000. Asha has not joined.
    const w = await world({ ashaJoined: false });
    await addExpense(w.gid, w.a, 90000, [[w.a, 30000], [w.r, 30000], [w.m, 30000]], "Dinner");
    const token = await payLinkFor(w.gid, w.r, w.a, w.a);
    const s = await readPayLink(token);
    expect(s.kind).toBe("owes");
    if (s.kind !== "owes") return;
    // The action itself.
    const url = await redirectOf(() => L.iPaidAction(form({ token })));
    expect(url.pathname).toBe(`/p/${token}`);
    expect(url.searchParams.get("paid")).toBe("1");
    const p = await db.payment.findFirstOrThrow({ where: { groupId: w.gid } });
    expect([p.fromId, p.toId, p.amount, p.createdById, p.needsOk]).toEqual([w.r, w.a, 30000, w.r, false]);
    expect(await net(w.gid)).toEqual({ [w.a]: 30000, [w.r]: 0, [w.m]: -30000 });
    expect((await db.payLink.findUniqueOrThrow({ where: { token } })).paymentId).toBe(p.id);
    expect(await db.paymentClaim.count({ where: { groupId: w.gid } })).toBe(0);
    // The history has the line and an Undo.
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: w.gid, paymentId: p.id } });
    expect(ev.text).toBe("paid Asha ₹300 (from the reminder link)");
    expect(JSON.parse(ev.undo)).toEqual({ type: "payment_delete", paymentId: p.id });
    // A second tap with the old read records nothing more.
    expect(await recordLinkPayment({ link: s.link, amount: s.amount, currency: "INR", toName: "Asha" })).toBe(false);
    expect(await payCount(w.gid)).toBe(1);
  });

  it("a joined Asha gets a payment too, not a note", async () => {
    const w = await world();
    await addExpense(w.gid, w.a, 90000, [[w.a, 30000], [w.r, 30000], [w.m, 30000]], "Dinner");
    const token = await payLinkFor(w.gid, w.r, w.a, w.a);
    await redirectOf(() => L.iPaidAction(form({ token })));
    expect(await payCount(w.gid)).toBe(1);
    expect(await db.paymentClaim.count({ where: { groupId: w.gid } })).toBe(0);
  });
});

describe("5: the link uses the group's currency", () => {
  it("the link uses the group's currency", async () => {
    const w = await world({ currency: "USD" });
    await addExpense(w.gid, w.a, 90000, [[w.a, 30000], [w.r, 30000], [w.m, 30000]], "Dinner");
    const s = await readPayLink(await payLinkFor(w.gid, w.r, w.a, w.a));
    expect(s.kind === "owes" && s.currency).toBe("USD");
  });
});

describe("10: the 'more than what's owed' page keeps back=settle", () => {
  it("overpayHref adds back=settle only from Settle up", () => {
    const q = { from: "r1", to: "a1", amount: "700", owes: "600" };
    expect(overpayHref("g1", q, true)).toBe("/groups/g1/pay?from=r1&to=a1&amount=700&owes=600&back=settle");
    expect(overpayHref("g1", q, false)).toBe("/groups/g1/pay?from=r1&to=a1&amount=700&owes=600");
  });

  it("Record a payment from Settle up for too much redirects with back=settle", async () => {
    // Ravi owes 60000 in all (auditor's story) but Asha is owed only 30000. He enters ₹700 from Settle up: the limit is the
    // smaller of the two (30000), and it is Asha's side that sets it.
    const w = await auditorWorld();
    await as(w, w.r);
    const url = await redirectOf(() => A.recordCustomPayment(form({ groupId: w.gid, fromId: w.r, toId: w.a, amount: "700", back: "settle" })));
    expect(url.pathname).toBe(`/groups/${w.gid}/pay`);
    expect(url.searchParams.get("back")).toBe("settle");
    expect(url.searchParams.get("owes")).toBe("30000");
    expect(url.searchParams.get("side")).toBe("to");
    expect(await payCount(w.gid)).toBe(0);
    // From the plain Record a payment page there is no back.
    const plain = await redirectOf(() => A.recordCustomPayment(form({ groupId: w.gid, fromId: w.r, toId: w.a, amount: "700" })));
    expect(plain.searchParams.get("back")).toBeNull();
  });
});

describe("8: the Settle up page asks canUndo, with the viewer and the payment, whether to show the Undo bar", () => {
  it("someone who left gets the bar only for their own move-out; the payment's people are read so a third person is not offered it", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${__dirname}/../src/app/groups/[id]/settle/page.tsx`, "utf8");
    expect(src).toMatch(/const undoViewer = \{ id: myId, isAdmin: await isGroupAdmin\(group\.id, myId\), closed: group\.closed, members: group\.members, payments: justDid \? await paymentsForUndo\(group\.id, justDid\.undo\) : \[\] \};/);
    expect(src).toMatch(/const showUndo = justDid && \(leaverChecks\?\.get\(justDid\.id\) \?\? canUndo\(justDid, undoEvents, new Date\(\), undoViewer\)\)\.ok;/);
    expect(src).not.toMatch(/\?\.leftAt && canUndo/);
  });
});

describe("N2: the pay link re-checks what is owed inside the write", () => {
  it("owedInTx sees a payment made after the page was read, and the link then records nothing", async () => {
    const w = await world({ ashaJoined: false });
    await addExpense(w.gid, w.a, 90000, [[w.a, 30000], [w.r, 30000], [w.m, 30000]], "Dinner");
    const s = await readPayLink(await payLinkFor(w.gid, w.r, w.a, w.a));
    expect(s.kind).toBe("owes");
    if (s.kind !== "owes") return;
    expect(await db.$transaction((tx) => owedInTx(tx, w.gid, w.r, w.a))).toBe(30000);
    // Meera records Ravi's ₹300 another way, just after the read.
    await db.$transaction((tx) => createPayment(tx, { groupId: w.gid, fromId: w.r, toId: w.a, amount: 30000, createdById: w.m }));
    expect(await db.$transaction((tx) => owedInTx(tx, w.gid, w.r, w.a))).toBe(0);
    expect(await recordLinkPayment({ link: s.link, amount: s.amount, currency: "INR", toName: "Asha" })).toBe(false);
    expect(await payCount(w.gid)).toBe(1); // Meera's only
    expect(await net(w.gid)).toEqual({ [w.a]: 30000, [w.r]: 0, [w.m]: -30000 });
  });
});

describe("N5: a name is never made from an email address", () => {
  async function newcomer(name: string) {
    const n = ++counter;
    const email = `zed.quill${n}-${stamp}@example.test`;
    const acc = await db.account.create({ data: { email, name } });
    accounts.push(acc.id);
    const g = await db.group.create({ data: { name: `N5 ${n} ${stamp}`, currency: "INR", inviteCode: `n5-${n}-${stamp}`, members: { create: [{ name: "Asha", claimedAt: new Date() }] } } });
    groups.push(g.id);
    return { acc: { id: acc.id, name: acc.name, email }, g };
  }

  it("no typed name and no account name: refused, nobody added, account unchanged", async () => {
    const { acc, g } = await newcomer("");
    expect(await joinNew(g.inviteCode, acc, "   ")).toEqual({ ok: false, reason: "name" });
    expect(NAME_NEEDED).toBe("Add your name so the group knows who you are.");
    expect(await db.member.count({ where: { groupId: g.id } })).toBe(1);
    expect((await db.account.findUniqueOrThrow({ where: { id: acc.id } })).name).toBe("");
  });

  it("a typed name is used and saved on the nameless account", async () => {
    const { acc, g } = await newcomer("");
    const r = await joinNew(g.inviteCode, acc, "Zed");
    expect(r.ok).toBe(true);
    expect((await db.member.findMany({ where: { groupId: g.id }, orderBy: { createdAt: "asc" } })).map((m) => m.name)).toEqual(["Asha", "Zed"]);
    expect((await db.account.findUniqueOrThrow({ where: { id: acc.id } })).name).toBe("Zed");
  });

  it("no typed name but the account has one: that name is used", async () => {
    const { acc, g } = await newcomer("Zoya");
    expect((await joinNew(g.inviteCode, acc, "")).ok).toBe(true);
    expect(await db.member.count({ where: { groupId: g.id, name: "Zoya" } })).toBe(1);
  });

  it("the join page shows the ask for ?error=name", () => {
    const src = readFileSync(`${__dirname}/../src/app/join/[code]/page.tsx`, "utf8");
    expect(src).toContain('error === "name"');
  });
});

describe("N6: Paid a different amount? keeps the way back", () => {
  it("the link carries back=settle and the pay page returns to Settle up", () => {
    expect(differentAmountHref("g1", "r1", "a1", "300")).toBe("/groups/g1/pay?from=r1&to=a1&amount=300&back=settle");
    // Settle up's rows are drawn by SettleRow, which builds the link with back=settle.
    const row = readFileSync(`${__dirname}/../src/components/SettleRow.tsx`, "utf8");
    expect(row).toContain("differentAmountHref(groupId, fromId, toId, amountInput)");
    const pay = readFileSync(`${__dirname}/../src/app/groups/[id]/pay/page.tsx`, "utf8");
    expect(pay).toContain('back={fromSettle ? `/groups/${group.id}/settle`');
  });
});
