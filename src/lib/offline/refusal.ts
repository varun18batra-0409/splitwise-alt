import { CARD_FEE_CHANGED, CURRENCY_CHANGED, PEOPLE_JOINED, PEOPLE_LEFT, type RefusalCode } from "./words";

// Which kind of "no" saveExpense's sentence is, so the phone can show it in the right place. Anything not listed is "invalid":
// still refused, still shown with the server's own sentence, still never saved.
export function refusalCodeOf(text: string): RefusalCode {
  if (text === PEOPLE_JOINED) return "people-joined";
  if (text === PEOPLE_LEFT) return "people-left";
  if (text === CURRENCY_CHANGED) return "currency";
  if (text === CARD_FEE_CHANGED) return "card-fee";
  if (/^This group is closed/.test(text)) return "closed";
  if (/^This group (no longer exists|was deleted)/.test(text)) return "deleted";
  if (/^(You left this group|Please join this group first)/.test(text)) return "left";
  if (/^Pick a real date/.test(text)) return "date";
  return "invalid";
}
