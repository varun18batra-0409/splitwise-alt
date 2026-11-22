import { cleanKey } from "../once";
import { OFFLINE_KEY_PREFIX } from "./words";
import type { DraftInput } from "./types";

// A hand-made or damaged request must get a calm "no", never a crash and never a half-read draft.
// Only the SHAPE is checked here (types, lengths, the key's prefix); every rule about money is saveExpense's.
// A card-night group holds up to 100 people (pot-db.ts), so a list of people may too.
const MAX_PEOPLE = 100;
const str = (x: unknown, max: number): string | null => (typeof x === "string" && x.length <= max ? x : null);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const id = (x: unknown): string | null => (typeof x === "string" && ID.test(x) ? x : null);
const idList = (x: unknown): string[] | null => (Array.isArray(x) && x.length <= MAX_PEOPLE && x.every((v) => id(v)) ? (x as string[]) : null);
const textMap = (x: unknown): Record<string, string> | null => {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const e = Object.entries(x as Record<string, unknown>);
  if (e.length > MAX_PEOPLE) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of e) {
    if (!ID.test(k) || typeof v !== "string" || v.length > 40) return null;
    out[k] = v;
  }
  return out;
};

export function readDraft(x: unknown): DraftInput | null {
  if (!x || typeof x !== "object") return null;
  const d = x as Record<string, unknown>;
  const key = cleanKey(d.key);
  if (!key || !key.startsWith(OFFLINE_KEY_PREFIX)) return null;
  const seen = d.seen as Record<string, unknown> | undefined;
  const day = typeof d.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.day) ? d.day : null;
  const out = {
    key,
    groupId: id(d.groupId),
    memberId: id(d.memberId),
    day,
    typedAt: typeof d.typedAt === "number" && Number.isFinite(d.typedAt) ? d.typedAt : null,
    name: str(d.name, 200),
    amount: str(d.amount, 40),
    currency: str(d.currency, 8),
    category: str(d.category, 40),
    paidById: id(d.paidById),
    multiPay: typeof d.multiPay === "boolean" ? d.multiPay : null,
    payers: textMap(d.payers),
    forMode: d.forMode === "everyone" || d.forMode === "selected" || d.forMode === "one" ? d.forMode : null,
    selected: idList(d.selected),
    onePersonId: d.onePersonId === "" ? "" : id(d.onePersonId),
    splitType: d.splitType === "equal" || d.splitType === "exact" || d.splitType === "percent" || d.splitType === "shares" ? d.splitType : null,
    exact: textMap(d.exact),
    percent: textMap(d.percent),
    shares: textMap(d.shares),
    kind: d.kind === "expense" || d.kind === "refund" ? d.kind : null,
    paymentMethod: str(d.paymentMethod, 20),
    markupChoice: d.markupChoice === "group" || d.markupChoice === "none" || d.markupChoice === "custom" ? d.markupChoice : null,
    markupCustom: str(d.markupCustom, 12),
    notes: str(d.notes, 1000),
    rateMode: d.rateMode === "auto" || d.rateMode === "manual" ? d.rateMode : null,
    manualRate: str(d.manualRate, 24),
    seen:
      seen && typeof seen === "object" && typeof seen.baseCurrency === "string" && seen.baseCurrency.length <= 8 && Number.isSafeInteger(seen.cardMarkupBp) && idList(seen.activeMemberIds) && typeof seen.snapshotAt === "string" && seen.snapshotAt.length <= 40
        ? { baseCurrency: seen.baseCurrency, cardMarkupBp: seen.cardMarkupBp as number, activeMemberIds: seen.activeMemberIds as string[], snapshotAt: seen.snapshotAt }
        : null,
  };
  if (Object.values(out).some((v) => v === null)) return null;
  return out as DraftInput;
}
