// The question asked before someone is marked as moved out: it names the final payments. Every payment is recorded as paid at that
// moment and everyone is told. A payment to someone who can answer (and who isn't the one doing this) also asks them to confirm it;
// if they say it wasn't received, the person who left comes back into the flat until it's sorted.
export function moveOutConfirm(opts: {
  leaverName: string; // "Ravi", or "you"
  payments: { from: string; to: string; amount: number; waits?: boolean }[]; // waits: the person paid is asked to confirm it
  nameOf: (memberId: string) => string; // "You" for the viewer
  money: (minor: number) => string;
  // Charges the person was paid (an earlier leaver's daily share) that go to this month's payer: one sentence in the question says so.
  handovers?: { amount: number; sharerName: string; billName: string; toName: string }[];
}): string {
  const { leaverName, payments, nameOf, money, handovers = [] } = opts;
  const who = leaverName === "you" ? "you" : leaverName;
  const markIt = who === "you" ? "Mark yourself as moved out?" : `Mark ${who} as moved out?`;
  // "This includes ₹208 Asha was paid for Ravi’s share of Milk, which goes to Meera, who now pays Milk."
  const handed = handovers.length
    ? ` ${handovers.map((h) => `This includes ${money(h.amount)} ${who === "you" ? "you were" : `${who} was`} paid for ${h.sharerName}’s share of ${h.billName}, which goes to ${h.toName}, who now pays ${h.billName}.`).join(" ")}`
    : "";
  if (payments.length === 0) return `No payments are needed: ${who === "you" ? "you are" : `${who} is`} square.${handed} ${markIt}`;
  const lines = payments.map((t) => {
    const from = nameOf(t.from);
    const to = t.to === t.from ? "themselves" : nameOf(t.to).replace(/^You$/, "you");
    const line = `${from} ${from === "You" ? "pay" : "pays"} ${to} ${money(t.amount)}`;
    return t.waits ? `${line} (${to === "you" ? "you are" : `${to} is`} asked to confirm it)` : line;
  });
  const someWait = payments.some((t) => t.waits);
  const back = who === "you" ? "you come back into the flat" : `${who} comes back into the flat`;
  const tail = someWait ? `They are recorded as paid and everyone is told. If a payment isn’t received, ${back} until it’s sorted.` : "They are recorded as paid and everyone is told.";
  return `Final payments: ${lines.join("; ")}. ${tail}${handed} ${markIt}`;
}
