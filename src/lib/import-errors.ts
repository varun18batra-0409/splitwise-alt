// Import messages are shown on a page from a signed link. What a file contains must never be repeated in them:
// a currency is named only if it is a plain three-letter code; anything else is not echoed.
export function unsupportedCurrencyError(currency: string): string {
  return /^[A-Z]{3}$/.test(currency) ? `Loopin doesn’t support ${currency} yet.` : "This file uses a currency Loopin doesn’t support yet.";
}

// The reason a line was skipped, with anything taken from the file removed ("“Bob” isn’t one of the people" and "in “xyz”" name no one).
export function safeSkipReason(reason: string): string {
  if (/^in [A-Z]{3}$/.test(reason)) return reason;
  if (/[“”"]/.test(reason) || /^in /.test(reason)) return "a name or currency couldn’t be matched";
  return reason;
}
