import { describe, expect, it } from "vitest";
import { confirmMovedBack, isBringBackLine, SETTLING_SELF, settlingFrom, settlingNamed, settlingTag, squareAgainText, withSettlingLeft, type HistoryLine } from "../src/lib/settling";
import { memberMark } from "../src/lib/left-view";

// "Settling up only" (pure rules). Someone who moved out and was brought back so they can settle is not a member again: the latest line in the
// group's history about them going out or coming back decides. Nothing is stored for it.
//   * latest line is a bring-back                                       -> settling up only (the day they moved out is kept in the line)
//   * latest is a rejoin / accepted invitation / Undo of the move-out / "moved back in"   -> a full member, even if an old move-out line stands
//   * latest is a move-out (including the automatic one when they are square again)       -> not in the group
// The last day used throughout: 10 Nov 2026 (the day C moved out).

const LAST = "2026-11-10T12:00:00.000Z";
const at = (min: number) => new Date(Date.UTC(2026, 10, 20, 9, min));
const C = "member-c";
const A = "member-a";

const moveOutLine = (who: string, min: number): HistoryLine => ({
  id: `mo-${who}-${min}`, kind: "member_left", text: "moved out (last day 10 Nov 2026)", createdAt: at(min),
  undo: JSON.stringify({ type: "member_set", memberId: who, data: { leftAt: null }, moveOut: { bills: [] } }),
});
// What bringBackLeavers writes now: the hidden `settling` flag, and the old last day in the undo data.
const bringBack = (who: string, min: number, over: Partial<HistoryLine> = {}): HistoryLine => ({
  id: `bb-${who}-${min}`, kind: "member_rejoined", text: "brought C back into Flat 402 until the ₹6,200 is sorted", createdAt: at(min),
  undo: JSON.stringify({ type: "member_set", memberId: who, data: { leftAt: LAST }, settling: true }), ...over,
});
// The same line as older code wrote it: no flag at all.
const bringBackOld = (who: string, min: number, text = "brought C back into Flat 402 until the ₹6,200 is sorted"): HistoryLine => ({
  id: `old-${who}-${min}`, kind: "member_rejoined", text, createdAt: at(min),
  undo: JSON.stringify({ type: "member_set", memberId: who, data: { leftAt: LAST } }),
});
const rejoined = (who: string, min: number, text = "rejoined the group"): HistoryLine => ({
  id: `rj-${who}-${min}`, kind: "member_rejoined", text, createdAt: at(min),
  undo: JSON.stringify({ type: "member_set", memberId: who, data: { leftAt: LAST } }),
});

describe("who is settling up only", () => {
  it("a bring-back with the new flag: C is settling, with the old last day 10 Nov", () => {
    const got = settlingFrom([moveOutLine(C, 1), bringBack(C, 5)], [A, C]);
    expect([...got.keys()]).toEqual([C]);
    expect(got.get(C)!.leftAt.toISOString()).toBe(LAST);
    expect(got.get(C)!.removedAt).toBeNull();
  });

  it("an older bring-back line with no flag is matched by its words (“brought C back into … until the … is sorted”) and gives the same answer", () => {
    for (const text of ["brought C back into Flat 402 until the ₹6,200 is sorted", "came back into Flat 402 until the ₹6,200 is sorted"]) {
      const got = settlingFrom([moveOutLine(C, 1), bringBackOld(C, 5, text)], [A, C]);
      expect(got.get(C)?.leftAt.toISOString(), text).toBe(LAST);
    }
    expect(isBringBackLine(bringBackOld(C, 5))).toBe(true);
  });

  it("other lines are not bring-backs: a rejoin, the Undo of a move-out, a plain move-out", () => {
    expect(isBringBackLine(rejoined(C, 5))).toBe(false);
    expect(isBringBackLine(rejoined(C, 5, "brought C back into the flat (undo)"))).toBe(false);
    expect(isBringBackLine(moveOutLine(C, 1))).toBe(false);
    // The words alone are not enough on a line of another kind.
    expect(isBringBackLine({ ...bringBackOld(C, 5), kind: "member_left" })).toBe(false);
  });

  it("the latest line is a rejoin, even with an old move-out line standing: a full member", () => {
    expect(settlingFrom([moveOutLine(C, 1), rejoined(C, 5)], [A, C]).size).toBe(0);
    // ...and a rejoin AFTER a bring-back ends it too.
    expect(settlingFrom([moveOutLine(C, 1), bringBack(C, 5), rejoined(C, 9)], [A, C]).size).toBe(0);
  });

  it("a bring-back that was undone does not count (the undo is its own line, and the row says they left)", () => {
    expect(settlingFrom([moveOutLine(C, 1), bringBack(C, 5, { undoneAt: at(6) })], [A]).size).toBe(0);
    // Undone, but the row is back in the group for some other reason and the earlier line is a plain move-out: still not settling.
    expect(settlingFrom([moveOutLine(C, 1), bringBack(C, 5, { undoneAt: at(6) })], [A, C]).size).toBe(0);
  });

  it("a later “moved back in” (a line with a mark, no undo) makes them a full member", () => {
    const back: HistoryLine = { id: "mb", kind: "member_rejoined", text: "moved back in on 15 Dec", details: JSON.stringify(["Bills are shared with them again from that day", memberMark(C)]), undo: "", createdAt: at(9) };
    expect(settlingFrom([moveOutLine(C, 1), bringBack(C, 5), back], [A, C]).size).toBe(0);
    // Before that line they were settling.
    expect(settlingFrom([moveOutLine(C, 1), bringBack(C, 5)], [A, C]).has(C)).toBe(true);
  });

  it("moved out again when square (a move-out line with a mark, no undo): not settling any more; bringing them back again makes them settling again", () => {
    const squareAgain: HistoryLine = { id: "sq", kind: "member_left", text: "is square again, so C is moved out again (last day 10 Nov)", details: JSON.stringify([memberMark(C)]), undo: "", createdAt: at(8) };
    expect(settlingFrom([moveOutLine(C, 1), bringBack(C, 5), squareAgain], [A]).size).toBe(0);
    // (Deleting C's payment: the row has left again, so bringBackLeavers writes a new line, newest of all.)
    const again = settlingFrom([moveOutLine(C, 1), bringBack(C, 5), squareAgain, bringBack(C, 12)], [A, C]);
    expect(again.get(C)?.leftAt.toISOString()).toBe(LAST);
  });

  it("someone removed from the group (not in the group now) is not settling", () => {
    expect(settlingFrom([moveOutLine(C, 1), bringBack(C, 5)], [A]).size).toBe(0);
  });

  it("only the person the line is about: A's lines never change C", () => {
    const got = settlingFrom([moveOutLine(C, 1), bringBack(C, 5), rejoined(A, 9)], [A, C]);
    expect([...got.keys()]).toEqual([C]);
  });

  it("lines handed over in any order are read oldest first, and equal times go by id", () => {
    const got = settlingFrom([rejoined(C, 9), bringBack(C, 5), moveOutLine(C, 1)], [A, C]);
    expect(got.size).toBe(0);
    const same: HistoryLine[] = [{ ...bringBack(C, 5), id: "b" }, { ...rejoined(C, 5), id: "a" }];
    expect(settlingFrom(same, [A, C]).has(C)).toBe(true); // "a" (rejoin) comes first, "b" (bring-back) is the latest
  });

  it("a removed person brought back keeps how they were removed (so moving them out again puts it back the same)", () => {
    const removedAt = "2026-11-12T08:00:00.000Z";
    const line = bringBack(C, 5, { undo: JSON.stringify({ type: "member_set", memberId: C, data: { leftAt: LAST, removedAt, removedById: A }, settling: true }) });
    const s = settlingFrom([line], [A, C]).get(C)!;
    expect([s.leftAt.toISOString(), s.removedAt?.toISOString(), s.removedById]).toEqual([LAST, removedAt, A]);
  });

  it("a bring-back with no readable last day is ignored rather than guessed", () => {
    expect(settlingFrom([bringBack(C, 5, { undo: JSON.stringify({ type: "member_set", memberId: C, data: {}, settling: true }) })], [C]).size).toBe(0);
  });
});

describe("bills see them as moved out from their original last day", () => {
  const m = (id: string, leftAt: Date | null) => ({ id, name: id, leftAt });
  const settling = settlingFrom([bringBack(C, 5)], [A, C]);

  it("C gets leftAt 10 Nov back; A is untouched; nothing settling gives back the same list", () => {
    const list = [m(A, null), m(C, null)];
    const got = withSettlingLeft(list, settling);
    expect(got[0]).toBe(list[0]);
    expect(got[1].leftAt?.toISOString()).toBe(LAST);
    expect(withSettlingLeft(list, new Map())).toBe(list);
  });

  it("a daily bill in their own move-out month (2026-11) keeps the old rule (not put back); in December they are", () => {
    const list = [m(A, null), m(C, null)];
    expect(withSettlingLeft(list, settling, { dailyMonth: "2026-11" })[1].leftAt).toBeNull();
    expect(withSettlingLeft(list, settling, { dailyMonth: "2026-12" })[1].leftAt?.toISOString()).toBe(LAST);
  });

  it("someone whose row already says they left keeps their own date", () => {
    const d = new Date("2026-10-01T12:00:00Z");
    expect(withSettlingLeft([m(C, d)], settling)[0].leftAt).toBe(d);
  });
});

describe("the words", () => {
  const s = settlingFrom([bringBack(C, 5)], [A, C]).get(C)!;
  it("the People tag, the refusals, the square-again line and the confirm", () => {
    expect(settlingTag(s)).toBe("Settling up only · moved out 10 Nov");
    expect(SETTLING_SELF).toBe("You moved out, so you can only settle up here.");
    expect(settlingNamed("C")).toBe("C moved out and is only settling up, so they can’t be in new expenses. If C has moved back in, mark that on People first.");
    expect(squareAgainText("C", s)).toBe("is square again, so C is moved out again (last day 10 Nov)");
    expect(confirmMovedBack("C", "2026-12-15")).toBe("C has moved back in? From 15 Dec, C shares bills again.");
  });
});
