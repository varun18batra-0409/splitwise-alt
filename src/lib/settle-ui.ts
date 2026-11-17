// Plain constants for the all-groups Settle up cards. Kept out of the "use client" component file so a server page can import them.

// "even" is neutral: nothing is owed either way, so no money colour.
export const TONE = { owe: "text-owe", owed: "text-owed", even: "text-fg" } as const;
// A long amount (₹1,23,456.78) must still fit a 320px phone: the size follows the number of characters.
const SIZE = {
  xl: "text-[34px] min-[360px]:text-[40px]",
  l: "text-[30px] min-[360px]:text-[34px]",
  m: "text-[24px] min-[360px]:text-[28px]",
} as const;
export function amountSize(text: string): string {
  const n = [...text].length;
  return SIZE[n <= 9 ? "xl" : n <= 12 ? "l" : "m"];
}

export const BIG_CREAM = "pop flex h-[52px] w-full min-w-0 items-center justify-center whitespace-nowrap bg-fg px-4 text-[16px] font-semibold text-canvas [--pop-edge:#6e6b63]";
export const BIG_OUTLINE =
  "flex h-[52px] w-full min-w-0 items-center justify-center whitespace-nowrap rounded-full border border-fg/30 px-4 text-[16px] font-semibold text-fg transition-transform active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100";

// How far a group is: paid back so far out of everything that needed paying back (paid + still left), as a whole percent.
// "100%" only when nothing is left, "0%" only when nothing is paid: a nearly done group reads 99, a barely started one 1.
export function settledPercent(paid: number, left: number): number {
  if (left <= 0) return 100;
  if (paid <= 0) return 0;
  return Math.min(99, Math.max(1, Math.round((paid / (paid + left)) * 100)));
}

// The words for "settled up". Someone who has left only knows their own side (you owe nobody, nobody owes you), so they never
// say anything about other people's money ("Nobody owes anybody") and nothing they share says it either.
export function squareWords(o: { leaver: boolean }) {
  const leaver = o.leaver;
  return {
    headline: leaver ? "You’re square" : "All square",
    line: leaver ? "You don’t owe anyone here, and no one owes you." : "Nobody owes anybody here.",
    nice: leaver ? "You don’t owe anyone, and no one owes you. Nice one." : "Nobody owes anybody. Nice one.",
    picture: leaver ? "You don’t owe anyone, and no one owes you." : "Nobody owes anybody.",
    share: (groupName: string) => (leaver ? `${groupName}: I’m square 🎉 I don’t owe anyone, and no one owes me.` : `${groupName}: all square 🎉 Nobody owes anybody.`),
  };
}

// What someone who has LEFT is told about money still open: only their own side, never a claim about the group
// ("N payments clear everything", "N instead of M"). `names` are first names; `fmt` writes the exact amount.
export function leaverMoneyLine(transfers: { from: string; to: string; amount: number }[], myId: string, nameOf: (id: string) => string, fmt: (minor: number) => string): string {
  const list = (ns: string[]) => (ns.length <= 1 ? ns.join("") : `${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`);
  const sum = (xs: { amount: number }[]) => xs.reduce((t, x) => t + x.amount, 0);
  const pay = transfers.filter((t) => t.from === myId);
  const get = transfers.filter((t) => t.to === myId);
  const parts: string[] = [];
  if (pay.length) parts.push(`You pay ${list(pay.map((t) => nameOf(t.to)))} ${fmt(sum(pay))} to be square.`);
  if (get.length) parts.push(`${list(get.map((t) => nameOf(t.from)))} ${get.length === 1 ? "owes" : "owe"} you ${fmt(sum(get))}.`);
  return parts.length ? parts.join(" ") : squareWords({ leaver: true }).line;
}
