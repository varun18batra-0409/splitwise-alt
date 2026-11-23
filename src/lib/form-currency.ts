import { CURRENCY_CHANGED } from "./offline/words";

// A form that posts an amount in the group's currency carries the currency the page was drawn in (a hidden "currency" field).
// If the group's currency was changed after the page was opened, the amount would be saved in the wrong currency (rupees as dollars),
// so the form is refused with the usual words. A form with no currency at all is a page opened before this check existed: refused
// once, calmly, and the next page has it.
export const FORM_OUT_OF_DATE = "This page is out of date. Open it again.";

export function formCurrencyRefusal(posted: FormDataEntryValue | null, groupCurrency: string): string | null {
  const text = typeof posted === "string" ? posted : "";
  if (!text) return FORM_OUT_OF_DATE;
  return text === groupCurrency ? null : CURRENCY_CHANGED;
}
