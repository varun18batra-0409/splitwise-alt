// Phone notifications, per person per group: all on unless switched off.
export type NotifyPrefs = { off: boolean; expenses: boolean; edits: boolean; payments: boolean; people: boolean };
type Kind = keyof Omit<NotifyPrefs, "off">;

export const NOTIFY_KINDS: { id: Kind; label: string }[] = [
  { id: "expenses", label: "New expenses" },
  { id: "edits", label: "Edits and deletions" },
  { id: "payments", label: "Payments" },
  { id: "people", label: "People joining or leaving" },
];

const DEFAULT: NotifyPrefs = { off: false, expenses: true, edits: true, payments: true, people: true };

export function parseNotify(json?: string | null): NotifyPrefs {
  if (!json) return { ...DEFAULT };
  try {
    const v = JSON.parse(json);
    if (!v || typeof v !== "object") return { ...DEFAULT };
    const pick = (k: keyof NotifyPrefs) => (typeof v[k] === "boolean" ? v[k] : DEFAULT[k]);
    return { off: pick("off"), expenses: pick("expenses"), edits: pick("edits"), payments: pick("payments"), people: pick("people") };
  } catch {
    return { ...DEFAULT };
  }
}

export function kindGroup(kind: string): Kind | null {
  if (kind === "expense_added") return "expenses";
  if (kind.startsWith("expense_")) return "edits";
  if (kind.startsWith("payment_")) return "payments";
  if (kind.startsWith("member")) return "people";
  return null;
}

export function wantsPush(prefs: NotifyPrefs, kind: string): boolean {
  if (prefs.off) return false;
  const k = kindGroup(kind);
  return k ? prefs[k] : true;
}
