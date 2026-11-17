import { describe, expect, it, vi } from "vitest";

// The Undo checks read each line's saved undo text once (not once per row per check), and find "which move-out does this line belong to"
// by a lookup. The answers stay exactly what the old pass over the whole history gave.

const spy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/events", async (orig) => {
  const real = await orig<typeof import("@/lib/events")>();
  return { ...real, parseUndo: (json: string) => (spy.calls++, real.parseUndo(json)) };
});

const { canUndo, historyCheck } = await import("@/lib/undo");

type Ev = Parameters<typeof historyCheck>[0];
const T = (min: number) => new Date(Date.UTC(2026, 10, 17, 6, min));
const ev = (id: string, kind: string, undo: object | string, min: number, over: Partial<Ev> = {}): Ev => ({
  id, kind, undo: typeof undo === "string" ? undo : JSON.stringify(undo), undoneAt: null, expenseId: null, paymentId: null, createdAt: T(min), ...over,
});
const moveOutOf = (memberId: string, lineIds: string[]) => ({
  type: "member_set", memberId, data: { leftAt: null },
  moveOut: { bills: [], money: { currency: "INR", shares: [], payments: [], eventIds: lineIds } },
});
const nameOf = (id: string) => (id === "m-ravi" ? "Ravi" : undefined);

// The old way, word for word: the first line in history order that is not this one, not undone, and lists this line as its own.
function oldOwner(e: Ev, all: Ev[]): Ev | undefined {
  for (const x of all) {
    if (x.id === e.id || x.undoneAt) continue;
    let q: { type?: string; data?: { leftAt?: unknown }; moveOut?: { money?: { eventIds: string[] } } } | null = null;
    try { q = JSON.parse(x.undo); } catch { q = null; }
    if (q?.type === "member_set" && q.data?.leftAt === null && q.moveOut?.money?.eventIds.includes(e.id)) return x;
  }
  return undefined;
}
const saysPart = (r: ReturnType<typeof historyCheck>) => !r.ok && r.reason.startsWith("This was part of");

function fixture() {
  const l1 = ev("l1", "bill_changed", { type: "expense_delete", expenseId: "x2" }, 1);
  const l2 = ev("l2", "payment_recorded", { type: "payment_delete", paymentId: "p1" }, 2, { paymentId: "p1" });
  const plain = ev("e1", "expense_added", { type: "expense_delete", expenseId: "x1" }, 0, { expenseId: "x1" });
  const mo = ev("mo", "member_left", moveOutOf("m-ravi", ["l1", "l2"]), 3);
  return { l1, l2, plain, mo, all: [plain, l1, l2, mo] };
}

describe("a move-out's own lines (D3-4)", () => {
  it("a line of a move-out says 'Undo the move-out instead'; a plain line does not; same as the old pass", () => {
    const { l1, l2, plain, mo, all } = fixture();
    for (const e of all) expect(saysPart(historyCheck(e, all, nameOf)), e.id).toBe(oldOwner(e, all) !== undefined);
    expect(historyCheck(l1, all, nameOf)).toEqual({ ok: false, reason: "This was part of Ravi’s move-out. Undo the move-out instead." });
    expect(historyCheck(l2, all, nameOf)).toEqual({ ok: false, reason: "This was part of Ravi’s move-out. Undo the move-out instead." });
    expect(historyCheck(plain, all, nameOf).ok).toBe(true);
    expect(historyCheck(mo, all, nameOf).ok).toBe(true);
  });

  it("once the move-out is undone, its lines are no longer blocked by it (read when asked, even on the same array)", () => {
    const { l1, mo, all } = fixture();
    expect(saysPart(historyCheck(l1, all, nameOf))).toBe(true); // builds the lookup for this array
    mo.undoneAt = T(10);
    expect(oldOwner(l1, all)).toBeUndefined();
    expect(historyCheck(l1, all, nameOf).ok).toBe(true);
  });

  it("when the move-out itself can no longer be undone, the line says it can't be undone on its own", () => {
    const { l1, all } = fixture();
    // The person was changed again after the move-out (a newer line about the same person): the move-out is blocked.
    const newer = ev("r1", "member_rejoined", { type: "member_set", memberId: "m-ravi", data: { leftAt: null } }, 20);
    const withNewer = [...all, newer];
    expect(oldOwner(l1, withNewer)?.id).toBe("mo");
    expect(historyCheck(l1, withNewer, nameOf)).toEqual({ ok: false, reason: "This was part of Ravi’s move-out, so it can’t be undone on its own." });
  });

  it("an array that gets a new line is read again", () => {
    const { l1, all } = fixture();
    const shorter = all.filter((x) => x.id !== "mo");
    expect(historyCheck(l1, shorter, nameOf).ok).toBe(true); // no move-out in this history
    shorter.push(all.find((x) => x.id === "mo")!);
    expect(saysPart(historyCheck(l1, shorter, nameOf))).toBe(true);
  });

  it("the move-out's own line in its own list is skipped (as before)", () => {
    const self = ev("mo2", "member_left", moveOutOf("m-ravi", ["mo2"]), 3);
    const other = ev("mo3", "member_left", moveOutOf("m-asha", ["mo2"]), 4);
    const all = [self, other];
    expect(oldOwner(self, all)?.id).toBe("mo3");
    expect(historyCheck(self, all, nameOf)).toMatchObject({ ok: false });
    expect(saysPart(historyCheck(self, all, nameOf))).toBe(true);
  });
});

describe("parsing the undo text (D3-4)", () => {
  it("60 Undo checks on the same 500 lines parse at most 500 + 60 x 3 times (the old way was about 60 x 500)", () => {
    const all: Ev[] = Array.from({ length: 500 }, (_, i) => ev(`e${i}`, "expense_added", { type: "expense_delete", expenseId: `x${i}` }, i % 50, { expenseId: `x${i}` }));
    const viewer = { id: "me", isAdmin: true, closed: false, members: [{ id: "me", name: "Me", accountId: null, leftAt: null, removedAt: null }] };
    spy.calls = 0;
    const answers = all.slice(0, 60).map((e) => canUndo(e, all, T(100), viewer));
    expect(spy.calls).toBeLessThanOrEqual(500 + 60 * 3);
    // And the answers are the plain ones: the newest line of each expense can be undone.
    expect(answers.every((a) => a.ok)).toBe(true);
    // Asking again about the same lines parses nothing new.
    const before = spy.calls;
    all.slice(0, 60).forEach((e) => canUndo(e, all, T(100), viewer));
    expect(spy.calls).toBe(before);
  });
});
