// Add expense: "Asha paid, split equally between all 4" and the result for you under it.
// Pure words only: nothing here changes what is saved. The pairs come from expensePairs (the same
// "who owes whom" the form already worked out for this expense), so the numbers match the save.

export type SplitKind = "equal" | "exact" | "shares" | "percent";

// "equally", "by amounts", "by shares", "by percentage", "by item", or the group's own split ("by our split").
export function howPhrase(x: { byItem: boolean; splitType: SplitKind; groupSplitOn: boolean; splitName: string }): string {
  if (x.byItem) return "by item";
  if (x.groupSplitOn) return `by ${x.splitName.toLowerCase()}`;
  if (x.splitType === "exact") return "by amounts";
  if (x.splitType === "shares") return "by shares";
  if (x.splitType === "percent") return "by percentage";
  return "equally";
}

// Who it is split between: "all 4", "both", "3 people", "Ravi", "no one yet".
export function whoPhrase(ids: string[], total: number, name: (id: string) => string): string {
  if (ids.length === 0) return "no one yet";
  if (ids.length === 1) return name(ids[0]);
  if (ids.length === total) return total === 2 ? "both" : `all ${total}`;
  return `${ids.length} people`;
}

export type ResultLine = { tone: "owe" | "owed" | "plain"; lead: string; amount: string };

// What this expense means for YOU, in words and colour. `money` formats minor units (the caller adds ≈ for foreign amounts).
// Orange = you owe, green = you get back, plain = nothing to settle. Money both ways is shown as two lines, never netted.
export function youResult(
  pairs: { from: string; to: string; amount: number }[],
  myId: string,
  justMe: boolean,
  name: (id: string) => string,
  money: (minor: number) => string,
): ResultLine[] {
  const out: ResultLine[] = [];
  const iOwe = pairs.filter((p) => p.from === myId);
  const owedMe = pairs.filter((p) => p.to === myId);
  if (iOwe.length) {
    const to = [...new Set(iOwe.map((p) => p.to))].map(name);
    const who = to.length === 1 ? to[0] : to.length === 2 ? `${to[0]} and ${to[1]}` : `${to.length} people`;
    out.push({ tone: "owe", lead: `You owe ${who}`, amount: money(iOwe.reduce((s, p) => s + p.amount, 0)) });
  }
  if (owedMe.length) {
    out.push({ tone: "owed", lead: "You get back", amount: money(owedMe.reduce((s, p) => s + p.amount, 0)) });
  }
  if (out.length) return out;
  if (pairs.length) return [{ tone: "plain", lead: "Not shared with you", amount: "" }];
  return [{ tone: "plain", lead: justMe ? "Just you" : "Nobody owes anyone", amount: "" }];
}

// The small currency sign for the big amount: ₹, $, €, ฿. Falls back to the code when the phone has no sign for it.
export function currencySign(code: string): string {
  try {
    const part = new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value;
    return part && part !== code ? part : code;
  } catch {
    return code;
  }
}
