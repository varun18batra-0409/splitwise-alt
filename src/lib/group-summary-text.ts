import { exactMoney } from "./money-display";
import { leaverMoneyLine, settleHeadline } from "./settle-ui";

// What the group's money card says, in one place: the online card (MoneyTicket) and the copy kept for offline both read it,
// so the two can never word the same balance differently.
type SummaryView = {
  myId: string;
  transfers: { from: string; to: string; amount: number }[];
  nameOf: (id: string) => string;
  leaver: unknown;
  money: (minor: number) => string;
};

// One plain line under the balance: who owes you (or whom you owe), and how many payments clear it all.
export function summaryLine(v: SummaryView): string {
  const { myId, transfers, nameOf } = v;
  const first = (id: string) => nameOf(id).trim().split(/\s+/)[0];
  const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
  const toMe = transfers.filter((t) => t.to === myId).map((t) => first(t.from));
  const fromMe = transfers.filter((t) => t.from === myId).map((t) => first(t.to));
  // Someone who left hears only about their own side (never "N payments clear everything").
  if (v.leaver) return leaverMoneyLine(transfers, myId, first, v.money);
  const clear = transfers.length === 0 ? (v.leaver ? settleHeadline({ leaver: true }).line : "Nobody owes anybody.") : `${transfers.length === 1 ? "1 payment clears" : `${transfers.length} payments clear`} everything.`;
  if (toMe.length) return `${list(toMe)} ${toMe.length === 1 ? "owes" : "owe"} you. ${clear}`;
  if (fromMe.length) return `You pay ${list(fromMe)}. ${clear}`;
  return clear;
}


// The big number on the money card: the label above it, the exact amount (paise included), and its tone.
export function balanceParts(mine: number, currency: string): { label: string; text: string; tone: "owed" | "owe" | "square" } {
  return {
    label: mine > 0 ? "You’re owed" : mine < 0 ? "You owe" : "Your balance",
    text: mine === 0 ? "All square" : exactMoney(Math.abs(mine), currency),
    tone: mine > 0 ? "owed" : mine < 0 ? "owe" : "square",
  };
}
