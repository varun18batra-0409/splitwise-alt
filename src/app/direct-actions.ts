"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { SITE_URL } from "@/lib/site";
import { redirect } from "@/lib/fresh-redirect";
import { db } from "@/lib/db";
import { getAccount, getMemberships, getMyMemberId } from "@/lib/identity";
import { allow, clientIp } from "@/lib/rate-limit";
import { cleanKey, fingerprintOf, isDuplicateKey } from "@/lib/once";
import { regionFor } from "@/lib/region";
import { isSupportedCurrency } from "@/lib/money";
import { isBlockedEitherWay } from "@/lib/blocks";
import { DIRECT, directEntryOn, NOT_DIRECT } from "@/lib/direct";
import { ensureAccountPair, ensureLocalPair, inviteDirectPerson, type PairResult } from "@/lib/direct-db";

// "With a person": picking someone starts (or finds) the pair, then goes straight to Add expense with them.
// Nothing is written to the pair's history until an expense is saved, and nobody is told before then.

const field = (f: FormData, k: string) => String(f.get(k) ?? "");

async function originOf() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return { origin: process.env.VERCEL_ENV === "production" ? SITE_URL : `${proto}://${host}`, ip: clientIp(h) };
}

// The currency a new pair starts in: the one your groups use most, else your region's. (The first expense can still change an empty pair.)
async function usualCurrency(memberships: Record<string, string>, homeCountry: string | null | undefined): Promise<string> {
  const ids = Object.keys(memberships);
  const rows = ids.length ? await db.group.groupBy({ by: ["currency"], where: { id: { in: ids }, deletedAt: null, ...NOT_DIRECT }, _count: { _all: true } }) : [];
  const top = [...rows].sort((a, b) => b._count._all - a._count._all)[0]?.currency;
  if (top && isSupportedCurrency(top)) return top;
  const region = regionFor(await headers(), homeCountry).currency;
  return isSupportedCurrency(region) ? region : "INR";
}

async function myNameFor(accountId: string, accountName: string): Promise<string> {
  if (accountName.trim()) return accountName.trim();
  const row = await db.member.findFirst({ where: { accountId, group: { ...NOT_DIRECT } }, select: { name: true }, orderBy: { createdAt: "asc" } });
  return row?.name.trim() || "Me";
}

const refuse = (error: string): never => redirect(`/add/person?${new URLSearchParams({ error })}`);

export async function startDirectWith(formData: FormData) {
  if (!directEntryOn()) redirect("/add");
  const account = await getAccount();
  if (!account) redirect("/signin?back=/add/person");
  const { origin, ip } = await originOf();
  if (!(await allow(`direct-start:${ip}`, 120, 3600))) refuse("Too many tries from here. Wait a bit.");

  const kind = field(formData, "kind");
  const rid = cleanKey(formData.get("rid"));
  const memberships = await getMemberships();
  const currency = await usualCurrency(memberships, account.homeCountry);
  const myName = await myNameFor(account.id, account.name);

  let r: PairResult;
  if (kind === "account") {
    r = await ensureAccountPair(account, field(formData, "accountId"), { currency, myName, requestKey: rid });
  } else if (kind === "pair") {
    // One of your own pairs, by its id: only if you are in it.
    const groupId = field(formData, "groupId");
    const myId = memberships[groupId];
    const g = myId ? await db.group.findUnique({ where: { id: groupId }, select: { id: true, type: true, deletedAt: true, members: { select: { id: true, accountId: true } } } }) : null;
    if (!g || g.deletedAt || g.type !== DIRECT || !myId) return refuse("That person isn’t there any more.");
    const other = g.members.find((m) => m.id !== myId);
    if (other?.accountId && (await isBlockedEitherWay(account.id, other.accountId))) return refuse("You can’t add expenses with this person.");
    r = { ok: true, groupId: g.id, myId, otherId: other?.id ?? "", created: false };
  } else {
    r = await ensureLocalPair(account, field(formData, "name"), { currency, myName });
  }
  if (!r.ok) return refuse(r.error);

  // A new name with an email: invite them, once (a second tap with the same one-time key does nothing more).
  const email = field(formData, "email").trim();
  if (kind === "new" && email) {
    let first = true;
    if (rid) {
      try {
        await db.requestKey.create({ data: { key: rid, result: "direct-invite", fingerprint: fingerprintOf("direct-invite", r.groupId, email.toLowerCase()) } });
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
        first = false;
      }
    }
    if (first) await inviteDirectPerson(r.groupId, r.myId, email, origin, (job) => after(job)).catch(() => undefined);
  }
  redirect(`/groups/${r.groupId}/add`);
}

// "Invite Rohan by email" on a name only you can see.
export async function inviteDirect(formData: FormData) {
  const groupId = field(formData, "groupId");
  const myId = await getMyMemberId(groupId);
  if (!myId) redirect("/private");
  const { origin, ip } = await originOf();
  if (!(await allow(`invite:${ip}`, 40, 3600))) redirect(`/people/${groupId}?${new URLSearchParams({ error: "Too many invites from here. Wait a bit." })}`);
  const r = await inviteDirectPerson(groupId, myId, field(formData, "email"), origin, (job) => after(job));
  redirect(`/people/${groupId}?${new URLSearchParams(r.ok ? { invited: "1" } : { error: r.error })}`);
}
