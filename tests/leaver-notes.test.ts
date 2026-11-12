import { afterAll, describe, expect, it, vi } from "vitest";

// SEC-08: someone who left still sees an older expense as it is now, but if it was changed AFTER they left, its notes are
// hidden from them: on the screens, in search, and in both spreadsheet downloads. People still in the group see everything.
//
// Fixture (all times relative to now): R leaves 5 days ago.
//   Dinner: created 10 days ago, notes "secret-dinner-note", edited 2 days ago (after R left)  -> hidden from R
//   Lunch:  created 10 days ago, notes "visible-lunch-note", edited 6 days ago (before R left) -> shown to R
//   Taxi:   created 10 days ago, notes "plain-taxi-note", never edited                          -> shown to R
const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test" }),
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { encodeSession, today } = await import("@/lib/session");
const { loadGroup, loadGroupView, loadMyGroups } = await import("@/lib/group-data");
const { hideLaterNotes } = await import("@/lib/left-view");
const { buildActivity, filterActivity } = await import("@/lib/activity");
const exportRoute = await import("@/app/groups/[id]/export/route");
const myData = await import("@/app/api/my-data/route");

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
let gid = "";
let A = "";
let R = "";
let M = "";

async function setup() {
  const g = await db.group.create({
    data: { name: `Notes ${stamp}`, inviteCode: `ln-${stamp}`, currency: "INR", members: { create: [{ name: "A", createdAt: ago(20) }, { name: "R", createdAt: ago(20) }, { name: "M", createdAt: ago(20) }] } },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  gid = g.id;
  [A, R, M] = ["A", "R", "M"].map((n) => g.members.find((m) => m.name === n)!.id);
  const mk = (description: string, notes: string, editedAt: Date | null) =>
    db.expense.create({
      data: { groupId: gid, description, notes, editedAt, splitType: "equal", amount: 90000, originalAmount: 90000, convertedAmount: 90000, paidById: A, createdById: A, createdAt: ago(10), shares: { create: [A, R, M].map((memberId) => ({ memberId, amount: 30000 })) } },
    });
  await mk("Dinner", "secret-dinner-note", ago(2));
  await mk("Lunch", "visible-lunch-note", ago(6));
  await mk("Taxi", "plain-taxi-note", null);
  await db.member.update({ where: { id: R }, data: { leftAt: ago(5) } });
}
const guest = async (id: string) => (state.cookie = await encodeSession({ m: { [gid]: id }, t: today() }));
const notesOf = (rows: { description: string; notes: string }[]) => Object.fromEntries(rows.map((e) => [e.description, e.notes]));

afterAll(async () => {
  await db.group.deleteMany({ where: { id: gid } });
});

describe("hideLaterNotes (pure)", () => {
  const cut = new Date("2026-11-10T10:00:00Z");
  const row = (notes: string, editedAt: string | null) => ({ notes, editedAt: editedAt ? new Date(editedAt) : null });
  it("blanks notes only when edited after the cut-off", () => {
    const out = hideLaterNotes([row("x", "2026-11-11T00:00:00Z"), row("y", "2026-11-09T00:00:00Z"), row("z", null), row("w", "2026-11-10T10:00:00Z")], cut);
    expect(out.map((e) => e.notes)).toEqual(["", "y", "z", "w"]); // exactly at the cut-off is not "after"
    expect(out.map((e) => e.notesHidden)).toEqual([true, undefined, undefined, undefined]);
  });
  it("says nothing when there were no notes to hide", () => {
    const out = hideLaterNotes([row("", "2026-11-11T00:00:00Z")], cut);
    expect(out[0].notesHidden).toBeUndefined();
  });
});

describe("a leaver does not see notes changed after they left", () => {
  it("screens: loadGroup and loadGroupView", async () => {
    await setup();
    for (const load of [loadGroup, loadGroupView]) {
      const asR = await load(gid, { viewer: R, events: false });
      expect(notesOf(asR!.group.expenses)).toEqual({ Dinner: "", Lunch: "visible-lunch-note", Taxi: "plain-taxi-note" });
      const dinner = asR!.group.expenses.find((e) => e.description === "Dinner") as { notesHidden?: boolean };
      expect(dinner.notesHidden).toBe(true);
      expect((asR!.group.expenses.find((e) => e.description === "Lunch") as { notesHidden?: boolean }).notesHidden).toBeUndefined();
      expect(notesOf(asR!.expenses)).toEqual({ Dinner: "", Lunch: "visible-lunch-note", Taxi: "plain-taxi-note" });
    }
  });
  it("a current member always sees every note", async () => {
    for (const load of [loadGroup, loadGroupView]) {
      const asA = await load(gid, { viewer: A, events: false });
      expect(notesOf(asA!.group.expenses)).toEqual({ Dinner: "secret-dinner-note", Lunch: "visible-lunch-note", Taxi: "plain-taxi-note" });
    }
  });
  it("search: the hidden note can't be found by the leaver, but can by a member", async () => {
    const asR = await loadGroup(gid, { viewer: R, events: false });
    const asA = await loadGroup(gid, { viewer: A, events: false });
    const nameOf = (id: string) => ({ [A]: "A", [R]: "R", [M]: "M" })[id] ?? "";
    const find = (g: NonNullable<typeof asR>, me: string, q: string) => filterActivity(buildActivity(g.group.expenses, g.group.payments, me), { q }, nameOf).map((i) => i.kind === "expense" ? i.title : "");
    expect(find(asR!, R, "secret-dinner-note")).toEqual([]);
    expect(find(asR!, R, "visible-lunch-note")).toEqual(["Lunch"]);
    expect(find(asA!, A, "secret-dinner-note")).toEqual(["Dinner"]);
    const item = buildActivity(asR!.group.expenses, asR!.group.payments, R).find((i) => i.kind === "expense" && i.title === "Dinner")!;
    expect(item).toMatchObject({ notes: "", notesHidden: true });
    // The cross-group search page's loader too.
    const mine = await loadMyGroups({ [gid]: R });
    expect(notesOf(mine[0].group.expenses)).toEqual({ Dinner: "", Lunch: "visible-lunch-note", Taxi: "plain-taxi-note" });
  });
  it("the group's CSV download", async () => {
    await guest(R);
    const res = await exportRoute.GET(new Request("https://loopin.test/x"), { params: Promise.resolve({ id: gid }) });
    const csv = await res.text();
    expect(res.status).toBe(200);
    expect(csv).toContain("Dinner");
    expect(csv).not.toContain("secret-dinner-note");
    expect(csv).toContain("visible-lunch-note");
    expect(csv).toContain("plain-taxi-note");
    await guest(A);
    const mem = await (await exportRoute.GET(new Request("https://loopin.test/x"), { params: Promise.resolve({ id: gid }) })).text();
    expect(mem).toContain("secret-dinner-note");
  });
  it("the 'download all my data' CSV", async () => {
    await guest(R);
    const csv = await (await myData.GET()).text();
    expect(csv).toContain("Dinner");
    expect(csv).not.toContain("secret-dinner-note");
    expect(csv).toContain("visible-lunch-note");
    await guest(A);
    expect(await (await myData.GET()).text()).toContain("secret-dinner-note");
  });
});
