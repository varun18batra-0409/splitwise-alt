import { memberOfChange } from "./left-view";

// "Settling up only" (pure rules).
//
// Someone who moved out and was brought back so they can settle (the person paid said "Not received", their square-up payment was
// deleted, or "Mark all paid" was undone) keeps their old balance and can record payments, but is NOT a member again: they are left out of
// every new bill month and new expense, bill payers, other people's move-outs, forecasts and people counts. For all of those they count
// as moved out from their ORIGINAL last day. Nothing is stored for this: it is read from the group's history, where the latest line
// about someone going out or coming back decides.
//   - latest line is a bring-back                              -> settling up only
//   - latest is a rejoin, an accepted invitation, an Undo of the move-out, or "moved back in" -> a full member
//   - latest is a move-out (or the automatic one when they are square again) -> not in the group (the row says so too)

export type Settling = { leftAt: Date; removedAt: Date | null; removedById: string };

// One line of the group's history about a person going out or coming back (kind "member_left" / "member_rejoined").
export type HistoryLine = { id?: string; kind: string; text: string; undo: string; details?: string | null; createdAt: Date; undoneAt?: Date | null };

// The wording of a bring-back line, for lines written before the hidden flag existed:
//   "brought Asha back into Goa until the ₹400 is sorted" / "came back into Goa until the ₹400 is sorted".
const BRING_BACK_WORDS = /\bback into .+ until the .+ is sorted$/;

type MemberSetUndo = { type?: string; memberId?: string; settling?: boolean; data?: { leftAt?: string | null; removedAt?: string | null; removedById?: string } };

function undoOf(json: string): MemberSetUndo | null {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as MemberSetUndo) : null;
  } catch {
    return null;
  }
}

// Is this line the bring-back of someone who had left? The hidden flag first, then the old wording.
export function isBringBackLine(l: Pick<HistoryLine, "kind" | "text" | "undo">): boolean {
  if (l.kind !== "member_rejoined") return false;
  const u = undoOf(l.undo);
  if (u?.type === "member_set" && u.settling === true) return true;
  return BRING_BACK_WORDS.test(l.text);
}

// The day they moved out and how they stood, as the bring-back line kept it (its undo puts them back exactly like this).
function originalOf(l: HistoryLine): Settling | null {
  const d = undoOf(l.undo)?.data;
  const left = d?.leftAt ?? d?.removedAt ?? null;
  if (!left) return null;
  const leftAt = new Date(left);
  if (Number.isNaN(leftAt.getTime())) return null;
  const removedAt = d?.removedAt ? new Date(d.removedAt) : null;
  return { leftAt, removedAt: removedAt && !Number.isNaN(removedAt.getTime()) ? removedAt : null, removedById: d?.removedById ?? "" };
}

// Who is settling up only, from the group's history lines (oldest first is not required) and who is in the group now (not left, not removed).
// A line that was undone does not count. Someone whose latest line is not a bring-back is not settling.
export function settlingFrom(lines: HistoryLine[], inGroupNow: Iterable<string>): Map<string, Settling> {
  const here = new Set(inGroupNow);
  const ordered = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !l.undoneAt && (l.kind === "member_left" || l.kind === "member_rejoined"))
    .sort((a, b) => a.l.createdAt.getTime() - b.l.createdAt.getTime() || (a.l.id ?? "").localeCompare(b.l.id ?? "") || a.i - b.i);
  const latest = new Map<string, HistoryLine>();
  for (const { l } of ordered) {
    const who = memberOfChange(l.undo, l.details);
    if (who) latest.set(who, l);
  }
  const out = new Map<string, Settling>();
  for (const [who, l] of latest) {
    if (!here.has(who) || !isBringBackLine(l)) continue;
    const was = originalOf(l);
    if (was) out.set(who, was);
  }
  return out;
}

// The members with settling people put back as moved out (their original last day), for bills, expenses and counts.
// `dailyMonth` ("2026-11"): in a person's own move-out month a daily bill keeps the rule it had before this change (their days up to the
// last day are written on the bill, see dailyMonthShares / withChargeDays in home/moving.ts), so they are left as they are for that month.
export function withSettlingLeft<M extends { id: string; leftAt: Date | null }>(members: M[], settling: ReadonlyMap<string, Settling>, o: { dailyMonth?: string } = {}): M[] {
  if (!settling.size) return members;
  return members.map((m) => {
    const s = settling.get(m.id);
    if (!s || m.leftAt) return m;
    if (o.dailyMonth && s.leftAt.toISOString().slice(0, 7) === o.dailyMonth) return m;
    return { ...m, leftAt: s.leftAt };
  });
}

// The words used when someone settling up only is stopped.
export const SETTLING_SELF = "You moved out, so you can only settle up here.";
export const settlingNamed = (who: string) => `${who} moved out and is only settling up, so they can’t be in new expenses. If ${who} has moved back in, mark that on People first.`;

// "Settling up only · moved out 10 Nov" (the People tag). `day` is "2026-11-10".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDay(d: Date): string {
  const iso = d.toISOString().slice(0, 10);
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}
export const settlingTag = (s: Settling) => `Settling up only · moved out ${shortDay(s.leftAt)}`;
export const squareAgainText = (who: string, s: Settling) => `is square again, so ${who} is moved out again (last day ${shortDay(s.leftAt)})`;
export const confirmMovedBack = (who: string, day: string) => `${who} has moved back in? From ${shortDay(new Date(`${day}T12:00:00Z`))}, ${who} shares bills again.`;
