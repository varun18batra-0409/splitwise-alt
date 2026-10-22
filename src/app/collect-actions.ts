"use server";

import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "@/lib/fresh-redirect";
import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { allow, clientIp } from "@/lib/rate-limit";
import { formatMoney } from "@/lib/money";
import { cleanNames } from "@/lib/names";
import { sendPushTo } from "@/lib/push";
import { createCollection, loadCollection, markPaid, organiserAction, undoPaid } from "@/lib/collect";

// Collect: making a collection (signed in), ticking "I've paid" (anyone with
// the link, no sign-up), and the organiser's controls.

// Which phone ticked a name, so only that phone can undo it. Not a sign-in.
const PAYER_COOKIE = "lp_payer";

async function payerKey(make: boolean): Promise<string> {
  const jar = await cookies();
  const have = jar.get(PAYER_COOKIE)?.value ?? "";
  if (/^[A-Za-z0-9_-]{16,64}$/.test(have) || !make) return have;
  const key = randomBytes(18).toString("base64url");
  jar.set(PAYER_COOKIE, key, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && process.env.E2E_PLAIN_HTTP !== "1", path: "/c", maxAge: 60 * 60 * 24 * 400 });
  return key;
}

const field = (f: FormData, k: string) => String(f.get(k) ?? "");
const cleanCode = (raw: string) => (/^[A-Za-z0-9_-]{6,40}$/.test(raw) ? raw : "");

export type CreateState = { error?: string };

export async function createCollectionAction(_prev: CreateState, f: FormData): Promise<CreateState> {
  const account = await getAccount();
  if (!account) redirect(`/signin?${new URLSearchParams({ back: "/collect/new" })}`);
  if (!(await allow(`collect-new:${clientIp(await headers())}`, 20, 3600))) return { error: "Lots of collections made from here in the last hour. Wait a bit and try again." };
  let name = account.name;
  if (!cleanNames([name])[0]) {
    name = cleanNames([field(f, "yourName")])[0] ?? "";
    if (!name) return { error: "Add your name, so people know who’s collecting." };
    await db.account.update({ where: { id: account.id }, data: { name } });
  }
  const r = await createCollection({ id: account.id, name }, {
    title: field(f, "title"),
    note: field(f, "note"),
    currency: field(f, "currency"),
    amount: field(f, "amount"),
    dueDate: field(f, "dueDate"),
    upiId: field(f, "upiId"),
    payLink: field(f, "payLink"),
    names: field(f, "names"),
  });
  if (!r.ok) return { error: r.error };
  redirect(`/c/${r.code}?new=1`);
}

// "I've paid": from the shared link, no sign-up needed.
export async function markPaidAction(f: FormData) {
  const code = cleanCode(field(f, "code"));
  if (!code) redirect("/");
  const back = (q: Record<string, string>) => `/c/${code}?${new URLSearchParams(q)}`;
  if (!(await allow(`collect-pay:${clientIp(await headers())}`, 30, 3600))) redirect(back({ error: "Lots of ticks from here in the last hour. Wait a bit and try again." }));
  const key = await payerKey(true);
  const entryId = field(f, "entryId");
  const r = await markPaid(code, { entryId: entryId && entryId !== "new" ? entryId : undefined, name: field(f, "name"), amount: field(f, "amount") }, key);
  if (!r.ok) redirect(back({ error: r.error }));
  after(() => tellOrganiser(code, r.entryId));
  redirect(back({ ticked: "1" }));
}

export async function undoPaidAction(f: FormData) {
  const code = cleanCode(field(f, "code"));
  if (!code) redirect("/");
  const r = await undoPaid(code, field(f, "entryId"), await payerKey(false));
  redirect(`/c/${code}?${new URLSearchParams(r.ok ? { undone: "1" } : { error: r.error })}`);
}

const KINDS = ["confirm", "unconfirm", "remove", "cash", "add", "close", "reopen", "delete"] as const;
type Kind = (typeof KINDS)[number];

export async function organiserActionForm(f: FormData) {
  const code = cleanCode(field(f, "code"));
  const account = await getAccount();
  if (!code) redirect("/");
  if (!account) redirect(`/signin?${new URLSearchParams({ back: `/c/${code}` })}`);
  const kind = field(f, "kind") as Kind;
  if (!KINDS.includes(kind)) redirect(`/c/${code}`);
  const r = await organiserAction(code, account.id, { kind, entryId: field(f, "entryId") || undefined, names: field(f, "names") });
  if (!r.ok) redirect(`/c/${code}?${new URLSearchParams({ error: r.error })}`);
  if (kind === "delete") redirect("/?collection=deleted");
  redirect(`/c/${code}${kind === "add" ? "?added=1" : ""}`);
}

// A note on the organiser's phones: "Ravi says they paid ₹300".
async function tellOrganiser(code: string, entryId: string) {
  const c = await loadCollection(code);
  const e = c?.entries.find((x) => x.id === entryId);
  if (!c || !e) return;
  const members = await db.member.findMany({ where: { accountId: c.accountId, leftAt: null }, select: { id: true } });
  await sendPushTo(
    members.map((m) => m.id),
    { title: c.title, body: `${e.name} says they paid ${formatMoney(e.amount, c.currency)}. Tap to check it off.`, url: `/c/${c.code}`, tag: `collect:${c.code}` },
  );
}
