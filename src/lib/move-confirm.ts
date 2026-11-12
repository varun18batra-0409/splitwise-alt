// The question asked before someone is marked as moved out: it names the final payments, because they are
// recorded as paid at that moment and everyone is told.
export function moveOutConfirm(opts: {
  leaverName: string; // "Ravi", or "you"
  payments: { from: string; to: string; amount: number }[];
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
    return `${from} ${from === "You" ? "pay" : "pays"} ${to} ${money(t.amount)}`;
  });
  return `Final payments: ${lines.join("; ")}. They are recorded as paid and everyone is told. ${markIt}`;
}
