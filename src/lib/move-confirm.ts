// The question asked before someone is marked as moved out: it names the final payments. A payment made by the person
// squaring up, to someone who can confirm it, is only an "I've paid" note: it counts when the person paid confirms it.
// Every other payment is recorded as paid at that moment. Everyone is told.
export function moveOutConfirm(opts: {
  leaverName: string; // "Ravi", or "you"
  payments: { from: string; to: string; amount: number; waits?: boolean }[]; // waits: the person paid confirms it before it counts
  nameOf: (memberId: string) => string; // "You" for the viewer
  money: (minor: number) => string;
}): string {
  const { leaverName, payments, nameOf, money } = opts;
  const who = leaverName === "you" ? "you" : leaverName;
  const markIt = who === "you" ? "Mark yourself as moved out?" : `Mark ${who} as moved out?`;
  if (payments.length === 0) return `No payments are needed: ${who === "you" ? "you are" : `${who} is`} square. ${markIt}`;
  const lines = payments.map((t) => {
    const from = nameOf(t.from);
    const to = t.to === t.from ? "themselves" : nameOf(t.to).replace(/^You$/, "you");
    const line = `${from} ${from === "You" ? "pay" : "pays"} ${to} ${money(t.amount)}`;
    return t.waits ? `${line} (${to === "you" ? "you confirm" : `${to} confirms`} it before it counts)` : line;
  });
  const someWait = payments.some((t) => t.waits);
  const allWait = payments.every((t) => t.waits);
  const tail = !someWait ? "They are recorded as paid and everyone is told." : allWait ? "Everyone is told." : "The others are recorded as paid, and everyone is told.";
  return `Final payments: ${lines.join("; ")}. ${tail} ${markIt}`;
}
