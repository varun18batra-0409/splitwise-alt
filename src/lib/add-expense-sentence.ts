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
  inShares = true, // you are one of the people it is split between
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
  // Others owe each other but nothing involves you: "You're square" if you are in the shares (what you put in equals your share),
  // "Not shared with you" only when you are not in the shares at all.
  if (pairs.length) return [{ tone: "plain", lead: inShares ? "You're square" : "Not shared with you", amount: "" }];
  if (justMe) return [{ tone: "plain", lead: "Just you", amount: "" }];
  return [{ tone: "plain", lead: "Nobody owes anyone", amount: "" }];
}

// "Split between" row: "Just you", "You and Asha", "Asha and Ravi", "6 people", or one other name.
export function whoRowPhrase(ids: string[], myId: string, name: (id: string) => string): string {
  if (ids.length === 0) return "No one yet";
  if (ids.length === 1) return ids[0] === myId ? "Just you" : name(ids[0]);
  if (ids.length === 2) {
    const [a, b] = ids[0] === myId || ids[1] !== myId ? ids : [ids[1], ids[0]];
    return `${name(a)} and ${name(b)}`;
  }
  return `${ids.length} people`;
}

// The second line of the "Split between" row: "Equally · ₹300 each", "By amounts", "By shares", "By percentage", "By item".
// `each` is the per-person figure, given only when the split is equal and every share is the same.
export function splitSubline(x: { byItem: boolean; splitType: SplitKind; groupSplitOn: boolean; splitName: string; each: string | null }): string {
  const how = howPhrase(x);
  const cap = how.charAt(0).toUpperCase() + how.slice(1);
  return how === "equally" && x.each ? `${cap} · ${x.each} each` : cap;
}

export type ResultPart = { text: string; amount: string; tone: "owe" | "owed" | "plain" };

// The one quiet line under the card: "Nupur paid ₹1,800. Your share is ₹300." / "You paid ₹2,400. You get back ₹1,800." /
// "Just you" / "You're square" / "Not shared with you". Display only: built from the same pairs the save uses.
export function resultSentence(x: {
  payers: { memberId: string; amount: number }[];
  total: number;
  pairs: { from: string; to: string; amount: number }[];
  myId: string;
  myShare: number; // what you owe for this expense (0 if not in the shares)
  inShares: boolean;
  justMe: boolean;
  refund: boolean;
  name: (id: string) => string; // "You" for yourself
  money: (minor: number) => string;
  // Foreign currency: the conversion line above already says what the whole thing comes to, so the sentence leaves out "You paid ≈ ₹5,151.34."
  // and gives only what it means for you ("You get back ≈ ₹3,863.50."). Default true.
  showPaid?: boolean;
}): ResultPart[] {
  const lines = youResult(x.pairs, x.myId, x.justMe, x.name, x.money, x.inShares);
  if (lines.length === 1 && lines[0].tone === "plain") return [{ text: lines[0].lead, amount: "", tone: "plain" }];
  const iPaid = x.payers.some((p) => p.memberId === x.myId);
  const who = x.payers.map((p) => x.name(p.memberId)).join(" + ");
  const verb = x.refund ? "got" : "paid";
  const head: ResultPart = { text: `${who} ${verb} ${x.money(x.total)}${x.refund ? " back" : ""}.`, amount: "", tone: "plain" };
  if (!x.refund && !iPaid && x.inShares && x.myShare > 0 && lines.length === 1 && lines[0].tone === "owe") {
    if (x.showPaid === false) return [{ text: "Your share is", amount: `${x.money(x.myShare)}.`, tone: "owe" }];
    return [head, { text: "Your share is", amount: `${x.money(x.myShare)}.`, tone: "owe" }];
  }
  if (x.showPaid === false) return lines.map((l) => ({ text: l.lead, amount: `${l.amount}.`, tone: l.tone }));
  return [head, ...lines.map((l) => ({ text: l.lead, amount: `${l.amount}.`, tone: l.tone }))];
}

// "$" alone means US dollars; other dollars get their own prefix so A$10 is never read as US$10.
const DOLLAR_SIGNS: Record<string, string> = { AUD: "A$", CAD: "C$", SGD: "S$", NZD: "NZ$", HKD: "HK$", MXN: "MX$", TWD: "NT$", ARS: "AR$", CLP: "CL$", COP: "CO$" };

// The small currency sign for the big amount: ₹, $, €, ฿, A$, C$. Falls back to the code when the phone has no sign for it.
export function currencySign(code: string): string {
  try {
    const part = new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value;
    if (part === "$" && code !== "USD") return DOLLAR_SIGNS[code] ?? `${code.slice(0, 2)}$`;
    return part && part !== code ? part : code;
  } catch {
    return code;
  }
}

// "1234567" -> "12,34,567" for INR (lakh style), "1,234,567" for the rest. Plain digits (and a decimal part) only: anything else
// the person typed (their own commas, "12,50") is shown exactly as typed. Display only.
export function groupDigits(raw: string, currency: string): string {
  const m = /^(\d+)(\.\d*)?$/.exec(raw.trim());
  if (!m) return raw;
  const int = m[1].replace(/^0+(?=\d)/, "");
  const grouped = currency === "INR" ? int.replace(/\B(?=(\d{2})*\d{3}$)/g, ",") : int.replace(/\B(?=(\d{3})+$)/g, ",");
  return grouped + (m[2] ?? "");
}
