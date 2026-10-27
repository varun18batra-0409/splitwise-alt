import { formatMoney } from "./money";

// The words for the day-end pulse (a trip's day, told playfully) and memory
// lane ("a year ago today"). Pure, so they can be tested.

export function pulseText(o: { place: string; day: number; of: number; spent: number; currency: string; count: number; topPayer?: string; topShare: number }): string {
  const money = formatMoney(o.spent, o.currency);
  const head = o.of > 1 ? `Day ${o.day} in ${o.place}: ${money} gone` : `${o.place} today: ${money} gone`;
  const tail =
    o.count === 1
      ? "one expense. Restrained 🧘"
      : o.topPayer && o.topShare >= 0.6
        ? `${o.topPayer}’s carrying the team 😅`
        : o.count >= 8
          ? `${o.count} expenses. Busy day 🔥`
          : `${o.count} expenses, shared fair and square 🤝`;
  return `${head}, ${tail}`;
}

export function memoryText(o: { place: string; years: number; people: number; days: number }): string {
  const when = o.years === 1 ? "A year ago today" : `${o.years} years ago today`;
  return `${when}: ${o.place}, ${o.people} of you${o.days > 1 ? `, ${o.days} days` : ""} 🌴 Tap to relive it`;
}
