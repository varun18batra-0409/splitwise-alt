// Shared bits for the pre-launch audit scripts. They run only against the
// throwaway copy of Loopin started inside the GitHub job (local database file,
// no live data, no emails sent). They refuse anything else.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { db } from "../../src/lib/db";
import { SESSION_COOKIE, encodeSession } from "../../src/lib/session";

export const base = process.env.AUDIT_BASE_URL || "http://localhost:3000";
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(base)) {
  console.error("Refusing: the audit only runs against the local throwaway copy.");
  process.exit(2);
}
if (!/^file:/.test(process.env.TURSO_DATABASE_URL ?? "")) {
  console.error("Refusing: the audit database must be a local file.");
  process.exit(2);
}

export const OUT = "audit-out";
mkdirSync(`${OUT}/evidence`, { recursive: true });
export const save = (name: string, data: unknown) => writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 1));

export const demo = JSON.parse(readFileSync(".demo.json", "utf8")) as {
  memberships: Record<string, string>;
  trip: { id: string; invite: string; expenseId: string; ravi: string; me: string };
  flat: { id: string; kabir: string };
  couple: { id: string; goal: string };
};

export async function cookieFor(m: Record<string, string>, a?: string) {
  return { name: SESSION_COOKIE, value: await encodeSession(a ? { m, a } : { m }), url: base };
}

// Every id the screens need, found in the demo data.
export async function ids() {
  const me = await db.member.findUnique({ where: { id: demo.trip.me }, select: { accountId: true } });
  const account = me?.accountId ? await db.account.findUnique({ where: { id: me.accountId } }) : await db.account.findFirst({ orderBy: { createdAt: "asc" } });
  const pot = await db.group.findFirst({ where: { type: "pot", deletedAt: null } });
  const game = pot ? await db.potGame.findFirst({ where: { groupId: pot.id } }) : null;
  const bill = await db.bill.findFirst({ where: { groupId: demo.flat.id, deletedAt: null } });
  const postcard = account ? await db.postcard.findFirst({ where: { OR: [{ fromId: account.id }, { toId: account.id }] } }) : await db.postcard.findFirst();
  const collection = await db.collection.findFirst();
  const other = account ? await db.account.findFirst({ where: { id: { not: account.id } } }) : null;
  const payLink = await db.payLink.findFirst();
  const memberships = { ...demo.memberships };
  if (pot) {
    const pm = await db.member.findFirst({ where: { groupId: pot.id } });
    if (pm) memberships[pot.id] = pm.id;
  }
  return { account, other, pot, game, bill, postcard, collection, payLink, memberships };
}

export { db };
