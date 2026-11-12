import { afterAll, describe, expect, it, vi } from "vitest";

// Each row runs every role through a real action against the database; on a busy CI machine one row
// can pass 5 s (seen once: "restore a payment" at 5.0 s), so this file gets more time per test.
vi.setConfig({ testTimeout: 30_000 });

// Who can do what, checked automatically.
//
// One kind of group is built again and again (a fresh, untouched copy for every try) with seven kinds of
// person looking at it:
//   admin     looks after the group (started it)
//   member    an ordinary member
//   left      left on their own
//   removed   taken out by the admin (can't rejoin on their own)
//   invited   was added by email: a name is in the group but they have not tapped Join
//   pending   an older person added straight in who never opened the group (treated like an outsider except Join)
//   outsider  has an account but nothing to do with the group
//
// Each person is signed in with a forged session cookie, the way the app sees them, so who they ARE in the
// group is decided by the real code (getMyMemberId), not by us. For every action the test writes down who may
// do it, runs it for every kind of person, and compares with what really happened in the database
// (did the expense get added, did the group close...). If any rule changes, one row of one table fails.
//
// The rules (Batch A and B): joined members (admin, member) can add, edit, delete and restore expenses,
// record and delete payments, undo, close and reopen, rename, add people and invite, move out, record a
// deposit, play card games, react and export. Only the admin changes the currency, deletes the group, makes a
// new invite link or removes people. Someone who left or was removed can only read what they are allowed to
// (export, my data, the group picture, bill photos) and a removed person can't join again. Pending and
// invited people are like outsiders for everything except Join.

const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test", "x-forwarded-for": `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }),
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
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("@/lib/push", async (orig) => ({ ...(await orig<typeof import("@/lib/push")>()), sendPushTo: async () => 0 }));

const { db } = await import("@/lib/db");
const { encodeSession, today } = await import("@/lib/session");
const { getMyMemberId, getMemberships } = await import("@/lib/identity");
const A = await import("@/app/actions");
const P = await import("@/app/pay-actions");
const R = await import("@/app/reaction-actions");
const { moveOut, saveDepositFor } = await import("@/lib/home/moving-db");
const { buyIn, finishGame } = await import("@/lib/pot-db");
const { setExpenseDeleted } = await import("@/lib/save-expense");
const { joinNew } = await import("@/lib/join");
const { acceptInvitation } = await import("@/lib/invitations");
const { canSeePassport } = await import("@/lib/passport-db");
const exportRoute = await import("@/app/groups/[id]/export/route");
const myDataRoute = await import("@/app/api/my-data/route");
const photoRoute = await import("@/app/api/group-photo/[id]/route");
const receiptRoute = await import("@/app/api/receipt/[id]/route");

type Persona = "admin" | "member" | "left" | "removed" | "invited" | "pending" | "outsider";
const PERSONAS: Persona[] = ["admin", "member", "left", "removed", "invited", "pending", "outsider"];
type Account = { id: string; name: string; email: string };

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
process.env.MAIL_OUTBOX = "1";
const groupIds: string[] = [];
const accountIds: string[] = [];
let counter = 0;
const yesterday = () => new Date(Date.now() - 86_400_000);

async function account(label: string, extra: { passportChoiceAt?: Date } = {}): Promise<Account> {
  const n = ++counter;
  const a = await db.account.create({ data: { email: `wcdw-${label}-${n}-${stamp}@example.test`, name: label, ...extra } });
  accountIds.push(a.id);
  return { id: a.id, name: label, email: a.email };
}
const cast = async () => ({
  admin: await account("Asha"),
  member: await account("Meera", { passportChoiceAt: new Date() }), // Meera tapped Show
  left: await account("Lou"),
  removed: await account("Rex"),
  invited: await account("Ivy"),
  pending: await account("Pete"),
  outsider: await account("Olga"),
  zed: await account("Zed"),
});
type Cast = Awaited<ReturnType<typeof cast>>;

type World = {
  id: string;
  name: string;
  code: string;
  rows: Record<"asha" | "meera" | "lou" | "rex" | "ivy" | "pete" | "zed", string>;
  seed: string; // an expense: Asha paid 10000, Asha 5000 and Meera 5000
  payment: string; // Meera paid Asha 1000 and Asha is asked "Got it?"
  token: string; // Ivy's invitation
};

// A fresh group. `ledger: false` leaves it with no money in it at all (so anyone may leave it).
async function world(c: Cast, label: string, o: { ledger?: boolean; type?: string } = {}): Promise<World> {
  const n = ++counter;
  const name = `Matrix ${label} ${n} ${stamp}`;
  const code = `wcdw-${n}-${stamp}`;
  const g = await db.group.create({
    data: {
      name, type: o.type ?? "home", currency: "INR", inviteCode: code,
      members: {
        create: [
          { name: "Asha", accountId: c.admin.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) },
          { name: "Meera", accountId: c.member.id, claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2) },
          { name: "Lou", accountId: c.left.id, claimedAt: new Date(2026, 0, 3), createdAt: new Date(2026, 0, 3), leftAt: yesterday() },
          { name: "Rex", accountId: c.removed.id, claimedAt: new Date(2026, 0, 4), createdAt: new Date(2026, 0, 4), leftAt: yesterday(), removedAt: yesterday(), removedById: "admin" },
          { name: "Ivy" }, // only a name: the invitation is by email
          { name: "Pete", accountId: c.pending.id, claimedAt: new Date(2026, 0, 5), createdAt: new Date(2026, 0, 5), addedBy: "someone-else" }, // never opened it
          { name: "Zed", accountId: c.zed.id, claimedAt: new Date(2026, 0, 6), createdAt: new Date(2026, 0, 6) }, // an ordinary member nobody owes anything
        ],
      },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (nm: string) => g.members.find((m) => m.name === nm)!.id;
  const rows = { asha: id("Asha"), meera: id("Meera"), lou: id("Lou"), rex: id("Rex"), ivy: id("Ivy"), pete: id("Pete"), zed: id("Zed") };
  await db.member.updateMany({ where: { id: rows.rex }, data: { removedById: rows.asha } });
  await db.member.updateMany({ where: { id: rows.pete }, data: { addedBy: rows.asha } });
  const token = `tok-${n}-${stamp}`;
  await db.invite.create({ data: { groupId: g.id, email: c.invited.email, invitedById: rows.asha, token, memberId: rows.ivy } });
  // Older than the day Lou and Rex left, so people who left may still see them.
  const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000);
  let seed = "";
  let payment = "";
  if (o.ledger !== false) {
    seed = (
      await db.expense.create({
        data: { groupId: g.id, description: "Seed", splitType: "equal", amount: 10000, originalAmount: 10000, convertedAmount: 10000, paidById: rows.asha, createdById: rows.asha, createdAt: fiveDaysAgo, shares: { create: [{ memberId: rows.asha, amount: 5000 }, { memberId: rows.meera, amount: 5000 }] } },
      })
    ).id;
    payment = (await db.payment.create({ data: { groupId: g.id, fromId: rows.meera, toId: rows.asha, amount: 1000, createdById: rows.meera, needsOk: true, createdAt: fiveDaysAgo } })).id;
  }
  return { id: g.id, name, code, rows, seed, payment, token };
}

async function signIn(c: Cast, p: Persona) {
  state.cookie = await encodeSession({ m: {}, a: c[p].id, v: 0, t: today() });
}
async function actorOf(w: World): Promise<string> {
  return (await getMyMemberId(w.id)) ?? "";
}
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
// Server actions end by redirecting (that is how Next.js moves on); here a redirect is just "it finished".
async function attempt(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    if (!/^NEXT_REDIRECT/.test(String((err as Error)?.message))) throw err;
  }
}

// Runs `run` once per kind of person on its own fresh group and compares with the table.
async function table(label: string, allowed: Persona[], run: (p: Persona, w: World, c: Cast) => Promise<boolean>, o: { ledger?: boolean; type?: string } = {}) {
  const c = await cast();
  const got: Record<string, boolean> = {};
  const want: Record<string, boolean> = {};
  for (const p of PERSONAS) {
    const w = await world(c, label, o);
    await signIn(c, p);
    got[p] = await run(p, w, c);
    want[p] = allowed.includes(p);
  }
  expect(got, label).toEqual(want);
}

afterAll(async () => {
  state.cookie = "";
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
  await db.outbox.deleteMany({ where: { to: { contains: stamp } } });
});

const JOINED_ACTIVE: Persona[] = ["admin", "member"];
const expenseInput = (w: World, extra: { expenseId?: string; name?: string } = {}) => ({
  groupId: w.id, name: "Matrix tea", category: "", amount: "100", currency: "INR", paidById: w.rows.asha, forMode: "everyone" as const, selected: [] as string[], onePersonId: "",
  splitType: "equal" as const, exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group" as const, markupCustom: "", rateMode: "auto" as const, manualRate: "", ...extra,
});

describe("opening the group", () => {
  it("only people who have really joined (even if they left, or were removed) have it among their groups; invited, pending and outsiders do not", async () => {
    await table("open", ["admin", "member", "left", "removed"], async (_p, w) => Object.keys(await getMemberships()).includes(w.id));
  });
});

describe("expenses", () => {
  it("add", () => table("add-expense", JOINED_ACTIVE, async (_p, w) => {
    await attempt(() => A.addExpense(expenseInput(w)));
    return (await db.expense.count({ where: { groupId: w.id, description: "Matrix tea" } })) === 1;
  }));

  it("edit", () => table("edit-expense", JOINED_ACTIVE, async (_p, w) => {
    await attempt(() => A.addExpense(expenseInput(w, { expenseId: w.seed, name: "Matrix edited" })));
    return (await db.expense.findUniqueOrThrow({ where: { id: w.seed } })).description === "Matrix edited";
  }));

  it("delete", () => table("delete-expense", JOINED_ACTIVE, async (_p, w) => {
    await attempt(() => A.deleteExpense(form({ groupId: w.id, expenseId: w.seed })));
    return (await db.expense.findUniqueOrThrow({ where: { id: w.seed } })).deletedAt !== null;
  }));

  it("restore", () => table("restore-expense", JOINED_ACTIVE, async (_p, w) => {
    await db.expense.update({ where: { id: w.seed }, data: { deletedAt: new Date(), deletedById: w.rows.asha } });
    await attempt(() => A.restoreExpense(form({ groupId: w.id, expenseId: w.seed })));
    return (await db.expense.findUniqueOrThrow({ where: { id: w.seed } })).deletedAt === null;
  }));

  it("react", () => table("react", JOINED_ACTIVE, async (_p, w) => {
    await attempt(() => R.reactAction(form({ expenseId: w.seed, emoji: "😂" })));
    return (await db.reaction.count({ where: { expenseId: w.seed } })) === 1;
  }));
});

describe("payments", () => {
  it("record a payment", () => table("record-payment", JOINED_ACTIVE, async (_p, w) => {
    await attempt(() => A.recordPayment(form({ groupId: w.id, fromId: w.rows.meera, toId: w.rows.asha, amount: "1234" })));
    return (await db.payment.count({ where: { groupId: w.id, amount: 1234 } })) === 1;
  }));

  it("delete a payment", () => table("delete-payment", JOINED_ACTIVE, async (_p, w) => {
    await attempt(() => A.removePayment(form({ groupId: w.id, paymentId: w.payment })));
    return (await db.payment.findUniqueOrThrow({ where: { id: w.payment } })).deletedAt !== null;
  }));

  it("restore a payment", () => table("restore-payment", JOINED_ACTIVE, async (_p, w) => {
    await db.payment.update({ where: { id: w.payment }, data: { deletedAt: new Date(), deletedById: w.rows.meera } });
    await attempt(() => A.restorePayment(form({ groupId: w.id, paymentId: w.payment })));
    return (await db.payment.findUniqueOrThrow({ where: { id: w.payment } })).deletedAt === null;
  }));

  it("'Not received' on a payment is for the person who was paid (Asha) only", () => table("reject-payment", ["admin"], async (_p, w) => {
    await attempt(() => P.rejectPaymentAction(form({ paymentId: w.payment })));
    return (await db.payment.findUniqueOrThrow({ where: { id: w.payment } })).deletedAt !== null;
  }));
});

describe("undo", () => {
  it("undo a change", () => table("undo", JOINED_ACTIVE, async (_p, w) => {
    // Asha deleted the expense a moment ago; the person undoing is whoever is signed in now.
    const done = await setExpenseDeleted(w.seed, w.rows.asha, true);
    if (!done.ok || !done.eventId) throw new Error("setup failed");
    await attempt(() => A.undoChange(form({ groupId: w.id, eventId: done.eventId!, back: "group" })));
    return (await db.expense.findUniqueOrThrow({ where: { id: w.seed } })).deletedAt === null;
  }));
});

describe("the group itself", () => {
  it("rename", () => table("rename", JOINED_ACTIVE, async (_p, w) => {
    await attempt(() => A.updateGroupSettings(form({ groupId: w.id, markup: "0", name: `Renamed ${w.name}` })));
    return (await db.group.findUniqueOrThrow({ where: { id: w.id } })).name === `Renamed ${w.name}`;
  }));

  it("change the currency (the admin only)", () => table("currency", ["admin"], async (_p, w) => {
    await attempt(() => A.convertGroupCurrency(form({ groupId: w.id, currency: "USD", rate: "0.012" })));
    return (await db.group.findUniqueOrThrow({ where: { id: w.id } })).currency === "USD";
  }));

  it("close", () => table("close", JOINED_ACTIVE, async (_p, w) => {
    await attempt(() => A.setGroupClosed(form({ groupId: w.id, closed: "1" })));
    return (await db.group.findUniqueOrThrow({ where: { id: w.id } })).closed === true;
  }));

  it("reopen", () => table("reopen", JOINED_ACTIVE, async (_p, w) => {
    await db.group.update({ where: { id: w.id }, data: { closed: true, closedAt: new Date() } });
    await attempt(() => A.setGroupClosed(form({ groupId: w.id, closed: "0" })));
    return (await db.group.findUniqueOrThrow({ where: { id: w.id } })).closed === false;
  }));

  it("delete the group (the admin only)", () => table("delete-group", ["admin"], async (_p, w) => {
    await attempt(() => A.deleteGroup(form({ groupId: w.id })));
    return (await db.group.findUniqueOrThrow({ where: { id: w.id } })).deletedAt !== null;
  }));

  it("restore a deleted group (whoever deleted it, or the admin: here only the admin)", () => table("restore-group", ["admin"], async (_p, w) => {
    await db.group.update({ where: { id: w.id }, data: { deletedAt: new Date(), deletedById: w.rows.asha } });
    await attempt(() => A.restoreGroup(form({ groupId: w.id })));
    return (await db.group.findUniqueOrThrow({ where: { id: w.id } })).deletedAt === null;
  }));

  it("a new invite link (the admin only)", () => table("new-link", ["admin"], async (_p, w) => {
    await attempt(() => A.makeNewInviteLink(form({ groupId: w.id })));
    return (await db.group.findUniqueOrThrow({ where: { id: w.id } })).inviteCode !== w.code;
  }));
});

describe("people", () => {
  it("add someone who is on Loopin", () => table("add-person", JOINED_ACTIVE, async (_p, w) => {
    const target = await account("Newbie");
    await attempt(() => A.addPerson(form({ groupId: w.id, accountId: target.id })));
    return (await db.invite.count({ where: { groupId: w.id, email: target.email } })) === 1;
  }));

  it("invite by email", () => table("invite-email", JOINED_ACTIVE, async (_p, w) => {
    const email = `wcdw-new-${++counter}-${stamp}@example.test`;
    await attempt(() => A.invitePeople(form({ groupId: w.id, emails: email })));
    return (await db.invite.count({ where: { groupId: w.id, email } })) === 1;
  }));

  it("rename someone", () => table("rename-person", JOINED_ACTIVE, async (_p, w) => {
    await attempt(() => A.renamePerson(form({ groupId: w.id, memberId: w.rows.zed, name: "Zedd" })));
    return (await db.member.findUniqueOrThrow({ where: { id: w.rows.zed } })).name === "Zedd";
  }));

  it("remove someone (the admin only)", () => table("remove", ["admin"], async (_p, w) => {
    await attempt(() => A.removePerson(form({ groupId: w.id, memberId: w.rows.zed })));
    return (await db.member.findUniqueOrThrow({ where: { id: w.rows.zed } })).removedAt !== null;
  }, { ledger: false }));

  it("leave the group yourself (anyone in it who is settled up)", () => table("leave", JOINED_ACTIVE, async (p, w) => {
    // People with a place in the group leave their own; the rest try to take Zed out.
    const own = ({ admin: w.rows.asha, member: w.rows.meera, left: w.rows.lou, removed: w.rows.rex, pending: w.rows.pete } as Record<string, string>)[p] ?? w.rows.zed;
    const before = (await db.member.findUniqueOrThrow({ where: { id: own } })).leftAt;
    await attempt(() => A.setPersonLeft(form({ groupId: w.id, memberId: own, left: "1" })));
    const after = (await db.member.findUniqueOrThrow({ where: { id: own } })).leftAt;
    return before === null && after !== null;
  }, { ledger: false }));

  it("bring back someone who left on their own (any member; they can also rejoin themselves)", () => table("bring-back-left", ["admin", "member", "left"], async (_p, w) => {
    await attempt(() => A.setPersonLeft(form({ groupId: w.id, memberId: w.rows.lou, left: "0" })));
    return (await db.member.findUniqueOrThrow({ where: { id: w.rows.lou } })).leftAt === null;
  }, { ledger: false }));

  it("bring back someone the admin removed (the admin only; not themselves)", () => table("bring-back-removed", ["admin"], async (_p, w) => {
    await attempt(() => A.setPersonLeft(form({ groupId: w.id, memberId: w.rows.rex, left: "0" })));
    const row = await db.member.findUniqueOrThrow({ where: { id: w.rows.rex } });
    return row.leftAt === null && row.removedAt === null;
  }, { ledger: false }));
});

describe("the flat: move-out and deposit", () => {
  it("move someone out", () => table("move-out", JOINED_ACTIVE, async (_p, w) => {
    const actor = await actorOf(w);
    const r = await moveOut(w.id, actor, { leaverId: w.rows.zed, lastDay: new Date().toISOString().slice(0, 10), requestKey: `wcdw-mv-${++counter}-${stamp}-abcdefgh` });
    return r.ok && (await db.member.findUniqueOrThrow({ where: { id: w.rows.zed } })).leftAt !== null;
  }));

  it("record the deposit", () => table("deposit", JOINED_ACTIVE, async (_p, w) => {
    const actor = await actorOf(w);
    const r = await saveDepositFor(w.id, actor, { heldBy: "Landlord", amounts: { [w.rows.zed]: "1000" } });
    return r.ok && (await db.depositShare.count({ where: { deposit: { groupId: w.id } } })) === 1;
  }));
});

describe("card games", () => {
  // A game Asha hosts: Asha and Meera each took 10000; Asha put back 15000 and Meera 5000 (balanced: Asha up 5000).
  async function game(w: World) {
    const g = await db.potGame.create({ data: { groupId: w.id, name: "Matrix game", game: "poker", players: JSON.stringify([w.rows.asha, w.rows.meera]), hostId: w.rows.asha } });
    await db.potMove.createMany({
      data: [
        { gameId: g.id, memberId: w.rows.asha, kind: "take", amount: 10000, createdById: w.rows.asha },
        { gameId: g.id, memberId: w.rows.meera, kind: "take", amount: 10000, createdById: w.rows.asha },
        { gameId: g.id, memberId: w.rows.asha, kind: "return", amount: 15000, createdById: w.rows.asha },
        { gameId: g.id, memberId: w.rows.meera, kind: "return", amount: 5000, createdById: w.rows.asha },
      ],
    });
    return g.id;
  }

  it("buy-in", () => table("buy-in", JOINED_ACTIVE, async (_p, w) => {
    const gameId = await game(w);
    const before = await db.potMove.count({ where: { gameId } });
    await buyIn(gameId, await actorOf(w), { memberIds: [w.rows.meera], amount: "100" });
    return (await db.potMove.count({ where: { gameId } })) === before + 1;
  }));

  it("finish the game (the host only: Asha)", () => table("finish-game", ["admin"], async (_p, w) => {
    const gameId = await game(w);
    await finishGame(gameId, await actorOf(w));
    return (await db.potGame.findUniqueOrThrow({ where: { id: gameId } })).status === "done";
  }));
});

describe("downloads and pictures", () => {
  const READERS: Persona[] = ["admin", "member", "left", "removed"];

  it("export the group as a spreadsheet", () => table("export", READERS, async (_p, w) => {
    const res = await exportRoute.GET(new Request("http://loopin.test/export"), { params: Promise.resolve({ id: w.id }) });
    return res.status === 200;
  }));

  it("download all my data: the group is in it only for people who have joined (left and removed people get what they may still see)", () => table("my-data", READERS, async (_p, w) => {
    const res = await myDataRoute.GET();
    if (res.status !== 200) return false;
    return (await res.text()).includes(w.name);
  }));

  it("the group picture", () => table("photo", READERS, async (_p, w) => {
    await db.groupPhoto.create({ data: { groupId: w.id, data: Buffer.from([1, 2, 3]), type: "image/webp" } });
    const res = await photoRoute.GET(new Request("http://loopin.test/photo"), { params: Promise.resolve({ id: w.id }) });
    return res.status === 200;
  }));

  it("a bill photo from before they left", () => table("receipt", READERS, async (_p, w) => {
    const r = await db.receipt.create({ data: { groupId: w.id, data: Buffer.from([1, 2, 3]), type: "image/jpeg", createdAt: new Date(Date.now() - 5 * 86_400_000) } });
    const res = await receiptRoute.GET(new Request("http://loopin.test/receipt"), { params: Promise.resolve({ id: r.id }) });
    return res.status === 200;
  }));
});

describe("passports", () => {
  it("whose passport Meera's can be opened by: people who have joined (even if they left), not removed, invited, pending or outsiders", async () => {
    const c = await cast();
    const w = await world(c, "passport");
    void w;
    const got: Record<string, boolean> = {};
    for (const p of PERSONAS) got[p] = (await canSeePassport(c[p].id, c.member.id)).ok;
    // Meera herself (the "member" row) always can; the rest follow the group.
    expect(got).toEqual({ admin: true, member: true, left: true, removed: false, invited: false, pending: false, outsider: false });
  });

  it("if Meera has not answered (an older account), nobody but Meera can open it: not even the admin or someone who left", async () => {
    const c = await cast();
    await db.account.update({ where: { id: c.member.id }, data: { passportChoiceAt: null } });
    await world(c, "passport-unanswered");
    const got: Record<string, boolean> = {};
    for (const p of PERSONAS) got[p] = (await canSeePassport(c[p].id, c.member.id)).ok;
    // Only Meera herself (the "member" row) can; everyone else is hidden whatever their place in the group.
    expect(got).toEqual({ admin: false, member: true, left: false, removed: false, invited: false, pending: false, outsider: false });
  });

  it("sending your passport: only someone who chose Show may send it", async () => {
    const { passportShared } = await import("@/lib/passport");
    expect(passportShared({ passportShare: "groups", passportChoiceAt: new Date() })).toBe(true); // tapped Show
    expect(passportShared({ passportShare: "groups", passportChoiceAt: null })).toBe(false); // never answered
    expect(passportShared({ passportShare: "private", passportChoiceAt: new Date() })).toBe(false); // Not now / Only me
    expect(passportShared({ passportShare: "private", passportChoiceAt: null })).toBe(false); // switched off before the change
  });
});

describe("joining", () => {
  it("join from the invite link: everyone except someone the admin removed", () => table("join", ["admin", "member", "left", "invited", "pending", "outsider"], async (p, w, c) => {
    const r = await joinNew(w.code, c[p], c[p].name);
    return r.ok;
  }));

  it("answer an invitation (Join): only the invited person and the pending older person have one", () => table("accept", ["invited", "pending"], async (p, w, c) => {
    const key = p === "pending" ? `m:${w.rows.pete}` : w.token;
    const r = await acceptInvitation(c[p], key);
    return r.ok;
  }));
});

// ---- Round 3 gaps ----
describe("people who left, and other groups", () => {
  it("the spreadsheet is refused 30 days after leaving (left and removed people), but not before", async () => {
    const c = await cast();
    const w = await world(c, "export-30");
    const old = new Date(Date.now() - 31 * 86_400_000);
    await db.member.update({ where: { id: w.rows.lou }, data: { leftAt: old } });
    await db.member.update({ where: { id: w.rows.rex }, data: { leftAt: old, removedAt: old } });
    const got: Record<string, number> = {};
    for (const p of ["left", "removed", "member"] as Persona[]) {
      await signIn(c, p);
      got[p] = (await exportRoute.GET(new Request("http://loopin.test/export"), { params: Promise.resolve({ id: w.id }) })).status;
    }
    expect(got).toEqual({ left: 403, removed: 403, member: 200 });
    // Left yesterday (the usual cast): still allowed.
    await db.member.update({ where: { id: w.rows.lou }, data: { leftAt: yesterday() } });
    await signIn(c, "left");
    expect((await exportRoute.GET(new Request("http://loopin.test/export"), { params: Promise.resolve({ id: w.id }) })).status).toBe(200);
  });

  it("an expense created after someone left is not in their spreadsheet or their view of the group, but the members see it", async () => {
    const c = await cast();
    const w = await world(c, "late");
    const late = `LATE-${stamp}-${++counter}`;
    await db.expense.create({
      data: { groupId: w.id, description: late, splitType: "equal", amount: 4000, originalAmount: 4000, convertedAmount: 4000, paidById: w.rows.asha, createdById: w.rows.asha, shares: { create: [{ memberId: w.rows.asha, amount: 2000 }, { memberId: w.rows.meera, amount: 2000 }] } },
    });
    const csvFor = async (p: Persona) => {
      await signIn(c, p);
      const res = await exportRoute.GET(new Request("http://loopin.test/export"), { params: Promise.resolve({ id: w.id }) });
      expect(res.status).toBe(200);
      return res.text();
    };
    expect(await csvFor("left")).not.toContain(late);
    expect(await csvFor("removed")).not.toContain(late);
    expect(await csvFor("member")).toContain(late);
    expect(await csvFor("member")).toContain("Seed"); // the older expense is still there for everyone

    const { loadGroup } = await import("@/lib/group-data");
    const lou = await loadGroup(w.id, { viewer: w.rows.lou });
    expect(lou?.group.expenses.some((e) => e.description === late)).toBe(false);
    expect(lou?.expenses.some((e) => e.description === "Seed")).toBe(true);
    const asha = await loadGroup(w.id, { viewer: w.rows.asha });
    expect(asha?.expenses.some((e) => e.description === late)).toBe(true);
  });

  it("someone who left can't bring back another person who left; members can", () => table("bring-back-other", ["admin", "member"], async (_p, w) => {
    const quin = await db.member.create({ data: { groupId: w.id, name: "Quin", leftAt: yesterday() } });
    await attempt(() => A.setPersonLeft(form({ groupId: w.id, memberId: quin.id, left: "0" })));
    return (await db.member.findUniqueOrThrow({ where: { id: quin.id } })).leftAt === null;
  }, { ledger: false }));

  it("an expense from another group can't be edited or deleted through this group", async () => {
    const c = await cast();
    const x = await world(c, "own-group");
    const y = await world(c, "other-group");
    await signIn(c, "member"); // Meera is in both groups
    expect(await actorOf(x)).toBe(x.rows.meera);
    await attempt(() => A.addExpense(expenseInput(x, { expenseId: y.seed, name: "Hijacked" })));
    await attempt(() => A.deleteExpense(form({ groupId: x.id, expenseId: y.seed })));
    await attempt(() => A.restoreExpense(form({ groupId: x.id, expenseId: y.seed })));
    expect(await db.expense.findUniqueOrThrow({ where: { id: y.seed } })).toMatchObject({ description: "Seed", deletedAt: null });
    expect(await db.expense.count({ where: { description: "Hijacked" } })).toBe(0);
    // And a person who is only in group X can't touch group Y's expense at all.
    const lone = await account("Lone");
    const solo = await db.group.create({ data: { name: `Solo ${stamp} ${++counter}`, inviteCode: `solo-${counter}-${stamp}`, members: { create: [{ name: "Lone", accountId: lone.id, claimedAt: new Date() }] } } });
    groupIds.push(solo.id);
    state.cookie = await encodeSession({ m: {}, a: lone.id, v: 0, t: today() });
    await attempt(() => A.deleteExpense(form({ groupId: solo.id, expenseId: y.seed })));
    expect((await db.expense.findUniqueOrThrow({ where: { id: y.seed } })).deletedAt).toBeNull();
  });
});
