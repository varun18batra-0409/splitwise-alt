// The quick line: type an expense the way you'd say it, and the form fills in.
//   "Dinner 2400 Ravi paid split with Asha Meera"
//   "Cab 600 except Dev"        "Asha paid 1.2k for groceries"
//   "Ravi ne 500 diye cab ke liye"   (a few common Hindi words)
// Rules only, no AI: Loopin knows the group's names, so it looks for a number
// (the amount), names next to "paid / by / with / for / except", and keeps the
// rest as the expense's name. It never saves: it fills the form to check. Pure.

export type QuickMember = { id: string; name: string };
export type QuickResult = {
  name: string; // what's left over, tidied
  amount: string; // as typed for the amount box ("2400", "1200")
  paidById?: string;
  forIds?: string[]; // who it's for (split equally); undefined = leave as it is
  understood: string[]; // short notes on what was picked up, for the confirmation line
};

const PAID = new Set(["paid", "pay", "payed", "diye", "diya", "di", "bhara", "bhare"]);
const BY = new Set(["by"]);
const WITH = new Set(["with", "split", "splitting", "between", "among", "amongst", "saath", "sath"]);
const FOR = new Set(["for", "liye"]);
const EXCEPT = new Set(["except", "excluding", "without", "minus", "not", "bina", "chhodke", "chodke"]);
const ALL = new Set(["everyone", "everybody", "all", "sab", "sabka", "sabke", "sabne", "group"]);
const ME = new Set(["i", "me", "my", "mine", "myself", "maine", "mera", "mere", "mujhe"]);
const FILLER = new Set(["and", "&", "+", "ne", "ke", "ka", "ki", "ko", "the", "a", "an", "of", "on", "at", "in", "to", "was", "it", "rs", "rs.", "inr", "usd", "us", "each", "equally", "equal"]);

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}&+.]/gu, "");

// "2,400" "₹2400" "$25.50" "1.2k" "2k" → "2400" / "25.50" / "1200"
function amountOf(tok: string): string | null {
  const t = tok.replace(/^[₹$£€¥]|^(rs\.?|inr|usd)/i, "").replace(/\/-$/, "").replace(/,/g, "");
  const m = t.match(/^(\d+(?:\.\d{1,2})?)(k)?$/i);
  if (!m) return null;
  if (m[2]) return String(Math.round(Number(m[1]) * 1000));
  return m[1];
}

export function parseQuickLine(text: string, members: QuickMember[], myId: string): QuickResult {
  const raw = text.trim().replace(/\s+/g, " ").slice(0, 200);
  // Split on spaces (and commas between words, not inside "2,000").
  const toks = raw.split(/\s+|,(?!\d{2})/).map((t) => t.replace(/[,;!?]+$/, "")).filter(Boolean);
  // Names: full names first ("Ravi Kumar"), then first names, unique within the group.
  const first = (n: string) => norm(n.split(" ")[0]);
  const firstCount = new Map<string, number>();
  for (const m of members) firstCount.set(first(m.name), (firstCount.get(first(m.name)) ?? 0) + 1);
  type Tok = { word: string; kind: "amount" | "person" | "paid" | "by" | "with" | "for" | "except" | "all" | "filler" | "text"; id?: string; amount?: string; len: number };
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; ) {
    const w = norm(toks[i]);
    // a member's full name (up to 3 words)
    let matched: Tok | null = null;
    for (let len = Math.min(3, toks.length - i); len >= 1 && !matched; len--) {
      const phrase = toks.slice(i, i + len).map(norm).join(" ");
      const full = members.filter((m) => m.name.trim().split(/\s+/).map(norm).join(" ") === phrase);
      if (full.length === 1) matched = { word: toks.slice(i, i + len).join(" "), kind: "person", id: full[0].id, len };
    }
    if (!matched) {
      const byFirst = members.find((m) => first(m.name) === w && firstCount.get(w) === 1);
      // a name with a possessive ("Ravi's")
      const poss = members.find((m) => `${first(m.name)}s` === w && firstCount.get(first(m.name)) === 1);
      const a = amountOf(toks[i]);
      if (byFirst) matched = { word: toks[i], kind: "person", id: byFirst.id, len: 1 };
      else if (ME.has(w)) matched = { word: toks[i], kind: "person", id: myId, len: 1 };
      else if (a && !out.some((t) => t.kind === "amount")) matched = { word: toks[i], kind: "amount", amount: a, len: 1 };
      else if (PAID.has(w)) matched = { word: toks[i], kind: "paid", len: 1 };
      else if (BY.has(w)) matched = { word: toks[i], kind: "by", len: 1 };
      else if (WITH.has(w)) matched = { word: toks[i], kind: "with", len: 1 };
      else if (FOR.has(w)) matched = { word: toks[i], kind: "for", len: 1 };
      else if (EXCEPT.has(w)) matched = { word: toks[i], kind: "except", len: 1 };
      else if (ALL.has(w)) matched = { word: toks[i], kind: "all", len: 1 };
      else if (poss) matched = { word: toks[i], kind: "text", len: 1 };
      else if (FILLER.has(w)) matched = { word: toks[i], kind: "filler", len: 1 };
      else matched = { word: toks[i], kind: "text", len: 1 };
    }
    out.push(matched);
    i += matched.len;
  }

  // Who paid: "<name> paid" / "<name> ne … diye", "paid by <name>", "I paid".
  let paidById: string | undefined;
  for (let i = 0; i < out.length; i++) {
    if (out[i].kind !== "paid") continue;
    const next = out.slice(i + 1).find((t) => t.kind !== "filler");
    if (next?.kind === "by") {
      const who = out.slice(i + 1).find((t) => t.kind === "person");
      if (who) paidById = who.id;
    } else {
      const before = [...out.slice(0, i)].reverse().find((t) => t.kind === "person" || t.kind === "with" || t.kind === "for" || t.kind === "except");
      if (before?.kind === "person") paidById = before.id;
    }
    if (paidById) break;
  }
  if (!paidById) {
    const by = out.findIndex((t) => t.kind === "by");
    const who = by >= 0 ? out.slice(by + 1).find((t) => t.kind === "person") : undefined;
    if (who) paidById = who.id;
  }

  // Who it's for: names after with / for / except, or everyone.
  const after = (k: Tok["kind"]) => {
    const i = out.findIndex((t) => t.kind === k);
    if (i < 0) return null;
    const ids: string[] = [];
    for (const t of out.slice(i + 1)) {
      if (t.kind === "person") ids.push(t.id!);
      else if (t.kind !== k && (t.kind === "with" || t.kind === "for" || t.kind === "except" || t.kind === "paid" || t.kind === "by")) break;
    }
    return ids;
  };
  const payer = paidById ?? myId;
  const everyone = members.map((m) => m.id);
  let forIds: string[] | undefined;
  const ex = after("except");
  const wi = after("with");
  const fo = after("for");
  // Hindi "X ke liye": the name comes before "liye".
  const keLiye = out.findIndex((t) => t.kind === "for" && norm(t.word) === "liye");
  const liyeIds = keLiye > 0 ? ([...out.slice(0, keLiye)].reverse().find((t) => t.kind === "person")?.id ?? null) : null;
  if (ex && ex.length) forIds = everyone.filter((id) => !ex.includes(id));
  else if (out.some((t) => t.kind === "all")) forIds = everyone;
  else if (wi && wi.length) forIds = [...new Set([payer, ...wi])];
  else if (fo && fo.length) forIds = [...new Set(fo)];
  else if (liyeIds && liyeIds !== paidById) forIds = [liyeIds];
  if (forIds) forIds = everyone.filter((id) => forIds!.includes(id)); // group order, only real members

  // The expense's name: the leftover words (and "for <thing>").
  const words = out.filter((t) => t.kind === "text").map((t) => t.word);
  const name = words.join(" ").replace(/^[-–:]+|[-–:]+$/g, "").trim();
  const amount = out.find((t) => t.kind === "amount")?.amount ?? "";
  const nameOf = (id: string) => (id === myId ? "you" : (members.find((m) => m.id === id)?.name ?? "?"));
  const understood = [
    ...(amount ? [amount] : []),
    ...(paidById ? [`${nameOf(paidById)} paid`] : []),
    ...(forIds ? [forIds.length === everyone.length ? "everyone" : `for ${forIds.map(nameOf).join(", ")}`] : []),
  ];
  return { name: name ? name.charAt(0).toUpperCase() + name.slice(1) : "", amount, paidById, forIds, understood };
}
