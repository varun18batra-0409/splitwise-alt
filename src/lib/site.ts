// The public address and the words search engines and link previews show.
export const SITE_URL = "https://www.loopinapps.com";
export const SITE_TITLE = "Loopin — split expenses with friends, flatmates & couples";
export const SITE_DESCRIPTION =
  "Free, no-ads app to split bills and shared expenses: trips, flat rent and bills, couples. Any currency, repeat bills, the fewest payments to settle up. Works on Android and iPhone.";

// Screens that are public and worth finding in search. Everything else is
// someone's own groups, sign-in or a form, and stays out of search.
export const PUBLIC_PAGES: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/how-it-works", priority: 0.9 },
  { path: "/switching", priority: 0.8 },
  { path: "/faq", priority: 0.7 },
  { path: "/welcome", priority: 0.6 },
  { path: "/privacy", priority: 0.3 },
  { path: "/terms", priority: 0.3 },
];
