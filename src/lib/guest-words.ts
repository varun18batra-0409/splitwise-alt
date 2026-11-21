// The words of a sign-in refusal, and the small functions that read and write them. No database here, so the sign-in sheet (a screen
// component) can use it. The rules themselves are in guest-rules.ts.

export const SIGNIN_TITLE = "Sign in to do this";
export const SIGNIN_BODY = "Changing things for the whole group needs a sign-in, so everyone can see who changed what. Your own expenses you can change any time.";
export const GUEST_REFUSAL = `${SIGNIN_TITLE}. ${SIGNIN_BODY}`;

// A payment from before the person took a freed name. NOT a sign-in refusal (signinKeyOf returns null for it): signing in won't help.
export const BEFORE_NAME_TEXT = "This payment is from before you took this name, so you can’t change it.";

const EXPENSE_PREFIX = "Sign in to change ";
const EXPENSE_SUFFIX = "’s expense";
export const expenseTitle = (name: string) => `${EXPENSE_PREFIX}${name}${EXPENSE_SUFFIX}`;
export const expenseRefusal = (name: string) => `${expenseTitle(name)}. ${SIGNIN_BODY}`;

// The short code that travels in the signed note ("general", or "expense:<name>"), or null when the text is not a sign-in refusal.
export function signinKeyOf(error: string | undefined | null): string | null {
  if (!error) return null;
  if (error === GUEST_REFUSAL) return "general";
  if (error.startsWith(EXPENSE_PREFIX) && error.endsWith(`. ${SIGNIN_BODY}`)) {
    const name = error.slice(EXPENSE_PREFIX.length, error.length - `. ${SIGNIN_BODY}`.length);
    if (name.endsWith(EXPENSE_SUFFIX)) return `expense:${name.slice(0, -EXPENSE_SUFFIX.length)}`;
  }
  return null;
}

// The words for the sheet's title and body, from the code in the note. Anything unknown reads as the general line.
export function signinWords(key: string | undefined | null): { title: string; body: string } {
  const m = /^expense:(.{1,60})$/.exec(key ?? "");
  return { title: m ? expenseTitle(m[1]) : SIGNIN_TITLE, body: SIGNIN_BODY };
}

// The notes for a redirect after a refusal: the plain sentence (every screen can show it) plus the code that opens the sheet.
export function refusalNotes(error: string): { error: string; signin?: string } {
  const signin = signinKeyOf(error);
  return signin ? { error, signin } : { error };
}

// "Since they took the name": a guest's name can be freed and picked up by someone else, and that new person must not inherit what the
// earlier holder added. So an item is theirs only if it was made at or after the moment this person claimed the name (no claimedAt known
// = not theirs). The same rule canDeleteMoment uses (moments-access.ts).
export function madeSinceClaim(claimedAt: Date | null | undefined, createdAt: Date | null | undefined): boolean {
  return Boolean(claimedAt) && Boolean(createdAt) && createdAt!.getTime() >= claimedAt!.getTime();
}

// "Made before the name was freed": once a name is freed (freedAt) and taken again, anything made to it at or before that moment belongs
// to the earlier holder. Equal instant or unknown time counts as the earlier holder's (the safe side). Never freed = false.
export function madeBeforeFreed(freedAt: Date | null | undefined, createdAt: Date | null | undefined): boolean {
  return Boolean(freedAt) && (!createdAt || createdAt.getTime() <= freedAt!.getTime());
}
