import { Prisma } from "@prisma/client";
import { CATEGORIES, LEGACY_CATEGORY_MAP, PLAIN_WORDS, getCategory } from "./categories";

// Search used to load every expense of every group and then look through them in the app. This works out, in the database, which
// expenses COULD match the typed words, so only those are read. It is a safety net, never a different answer: the very same
// look-through (filterActivity) still runs on what comes back, and the database side only ever leaves out an expense when
// it is certain no word-match is possible. Anything it cannot be certain about is kept:
//  - words with anything but plain keyboard letters, digits and signs (the database lowers case for plain letters only): no pre-filter at all,
//  - expenses whose title or notes hold such a character, and card-game results (their title is reworded on screen): always kept,
//  - categories the app doesn't know by name: always kept.
export type SearchMember = { id: string; name: string };

/** The typed words, split exactly as the search itself splits them. */
export const searchWords = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean);

/** True when the database can pre-filter these words with certainty (plain keyboard characters only). */
export const canPrefilter = (words: string[]): boolean => words.length > 0 && words.every((w) => /^[\x21-\x7e]+$/.test(w));

// Every category name an expense might hold: the current ones and the old ones that map onto them.
const KNOWN_CATEGORY_KEYS = [...CATEGORIES.map((c) => c.id), ...Object.keys(LEGACY_CATEGORY_MAP)];

/** The category values whose label or plain words contain `word` (what the search text holds for a category). */
export function categoryKeysMatching(word: string): string[] {
  return KNOWN_CATEGORY_KEYS.filter((k) => {
    const c = getCategory(k);
    return `${c.label} ${PLAIN_WORDS[c.id] ?? ""}`.toLowerCase().includes(word);
  });
}

/** The people whose name, as the search sees it (the viewer's own is "<name> you"), contains `word`. */
export function membersMatching(word: string, members: SearchMember[], myId: string): string[] {
  return members.filter((m) => (m.id === myId ? `${m.name} you` : m.name).toLowerCase().includes(word)).map((m) => m.id);
}

/** The SQL that picks the expense ids of one group that could match all the words. Null = no certainty possible, read everything. */
export function candidateIdsQuery(groupId: string, words: string[], members: SearchMember[], myId: string): Prisma.Sql | null {
  if (!canPrefilter(words)) return null;
  const perWord = words.map((w) => {
    const parts: Prisma.Sql[] = [Prisma.sql`instr(lower("description"), ${w}) > 0`, Prisma.sql`instr(lower("notes"), ${w}) > 0`];
    if ("someone".includes(w)) parts.push(Prisma.sql`1 = 1`); // a person the app can't name reads "Someone"
    const cats = categoryKeysMatching(w);
    if (cats.length) parts.push(Prisma.sql`"category" IN (${Prisma.join(cats)})`);
    const who = membersMatching(w, members, myId);
    if (who.length) {
      parts.push(Prisma.sql`"paidById" IN (${Prisma.join(who)})`);
      parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "ExpenseShare" s WHERE s."expenseId" = "Expense"."id" AND s."memberId" IN (${Prisma.join(who)}))`);
      for (const id of who) parts.push(Prisma.sql`instr("payers", ${id}) > 0`);
    }
    return Prisma.sql`(${Prisma.join(parts, " OR ")})`;
  });
  return Prisma.sql`
    SELECT "id" FROM "Expense"
    WHERE "groupId" = ${groupId} AND "deletedAt" IS NULL AND (
      (${Prisma.join(perWord, " AND ")})
      OR "kind" = 'pot'
      OR "category" NOT IN (${Prisma.join(KNOWN_CATEGORY_KEYS)})
      OR "description" GLOB '*[^ -~]*'
      OR "notes" GLOB '*[^ -~]*'
    )`;
}
