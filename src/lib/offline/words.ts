// The words for "add expenses offline" (version 1). One file, so the server's refusals and the phone's screens say the same thing.
// No imports: it is used by the server, the service-worker screens and the tests.

// The switch. With it off nothing is kept on phones, nothing is redirected and today's plain offline message shows.
export function offlineOn(value: string | undefined = process.env.OFFLINE_ADD): boolean {
  return /^(1|on|true|yes)$/i.test((value ?? "").trim());
}

export const MAX_DRAFTS = 50; // per phone
export const COPY_DAYS = 30; // a group's offline copy stops showing after this many days without being opened online
export const OFFLINE_KEY_PREFIX = "off-";
export const OFFLINE_KEY_KEEP_DAYS = 400; // the daily clean-up keeps these one-time keys this long (ordinary ones: 30 days)

// Why the server refused a draft. The draft stays on the phone ("refused") so the person can open and fix it, or remove it.
export type RefusalCode =
  | "people-joined"
  | "people-left"
  | "currency"
  | "card-fee"
  | "other-person"
  | "pair"
  | "no-rate"
  | "closed"
  | "deleted"
  | "left"
  | "date"
  | "invalid";

export const PEOPLE_JOINED = "Someone joined the group since you saved this. Open it and check the split.";
export const PEOPLE_LEFT = "Someone in this expense has left the group since you saved it. Open it and fix the split.";
export const CURRENCY_CHANGED = "The group’s currency changed since you saved this. Open it and check the amount.";
export const CARD_FEE_CHANGED = "The group’s card fee changed since you saved this. Open it and check the total.";
export const OTHER_PERSON = "A different person is signed in on this phone now, so this wasn’t added. It stays here for the person who saved it.";
export const PAIR_REFUSED = "Expenses with one person can’t be added from this phone while offline. Open it online to add it.";
export const NO_RATE_PREFIX = "There is no exchange rate for";
export const NO_RATE = (dayText: string) => `${NO_RATE_PREFIX} ${dayText}. Open it and enter the rate yourself.`;
export const NOT_SIGNED_IN = "You’re not signed in as the person who saved this, so it wasn’t added.";

// The sheet and screens (the founder's approved mockups, word for word).
export const W = {
  offlineTag: "Offline",
  youreOffline: "You’re offline",
  offlineHeader: "You’re offline. This saves on your phone for now.",
  saveOnPhone: "Save on this phone",
  saveNote: "When you’re back online, Loopin asks before adding it.",
  peopleNote: (group: string) => `The people are the ones ${group} had when you were last online.`,
  asOf: (time: string) => `As of ${time}, when you were last online`,
  settleOffline: "Settle up when online",
  waitingNote: "They count once you’re back online and add them. The amount above doesn’t include them yet.",
  waitingTitle: (n: number) => `${n} ${n === 1 ? "expense" : "expenses"} waiting on this phone`,
  onThisPhone: "On this phone",
  backOnline: "You’re back online",
  sheetIntro: (n: number, group: string) => `You added ${n} ${n === 1 ? "expense" : "expenses"} while offline. Add ${n === 1 ? "it" : "them"} to ${group}?`,
  addN: (n: number, group: string) => `Add ${n} to ${group}`,
  notNow: "Not now",
  notNowNote: "Not now keeps them on this phone. Nothing is lost.",
  sameRemove: "Same, remove mine",
  differentKeep: "Different, keep both",
  duplicateQ: (by: string, name: string, amount: string, at: string) => `${by} added ${name} ${amount} at ${at}. Is it the same one?`,
  openAndFix: "Open and fix",
  removeFromPhone: "Remove from this phone",
  tryAgain: "Try again",
  noPrivate: "This phone can’t keep expenses offline in a private window.",
  tooMany: `This phone is keeping ${MAX_DRAFTS} expenses already. Add them when you’re online, then save more.`,
  foreignNote: (day: string) => `The rate for ${day} is added when it’s added online.`,
  signOutWarn: (n: number) => `${n} ${n === 1 ? "expense is" : "expenses are"} waiting on this phone and ${n === 1 ? "hasn’t" : "haven’t"} been added. Signing out removes ${n === 1 ? "it" : "them"} from this phone.`,
} as const;
