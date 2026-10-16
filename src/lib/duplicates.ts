import { db } from "./db";
import { guessCategory, isCategory } from "./categories";

// "Looks like a duplicate": the same amount in the same group, spent within
// 2 days, with a similar name or in the same category. Money back is never
// flagged. Only checked for new expenses, and the person can always add it anyway.

const SMALL = new Set(["a", "an", "the", "at", "in", "on", "for", "to", "of", "and", "with", "&"]);

export function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !SMALL.has(w))
    .sort()
    .join(" ");
}

export type DuplicateHit = { id: string; description: string; amount: number; by: string; when: Date };

export async function findLikelyDuplicate(
  groupId: string,
  x: { amount: number; name: string; category: string; spentAt: Date; kind: string },
): Promise<DuplicateHit | null> {
  if (x.kind === "refund") return null;
  const window = 2 * 86_400_000;
  const near = await db.expense.findMany({
    where: {
      groupId,
      amount: x.amount,
      deletedAt: null,
      kind: "expense",
      OR: [
        { spentAt: { gte: new Date(x.spentAt.getTime() - window), lte: new Date(x.spentAt.getTime() + window) } },
        { spentAt: null, createdAt: { gte: new Date(x.spentAt.getTime() - window), lte: new Date(x.spentAt.getTime() + window) } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { group: { select: { members: { select: { id: true, name: true } } } } },
  });
  const name = normaliseName(x.name);
  const category = isCategory(x.category) ? x.category : guessCategory(x.name);
  // "Other" is too common to mean anything on its own.
  const hit = near.find((e) => (name && normaliseName(e.description) === name) || (category !== "other" && e.category === category));
  if (!hit) return null;
  const by = hit.group.members.find((m) => m.id === (hit.createdById || hit.paidById))?.name ?? "someone";
  return { id: hit.id, description: hit.description, amount: hit.amount, by, when: hit.spentAt ?? hit.createdAt };
}
