"use server";

import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "@/lib/fresh-redirect";
import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { deliverNotes } from "@/lib/account-notes";
import { allow, clientIp } from "@/lib/rate-limit";
import { formatMoney } from "@/lib/money";
import { cleanNames } from "@/lib/names";
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

// On an error the typed values come back too, so the form shows them again
// (React clears a form after sending it).
export type CreateState = { error?: string; values?: Record<string, string> };
const FORM_FIELDS = ["yourName", "title", "amount", "currency", "upiId", "payLink", "dueDate", "names", "note", "contacts"] as const;
const typed = (f: FormData) => Object.fromEntries(FORM_FIELDS.map((k) => [k, field(f, k).slice(0, k === "contacts" ? 60_000 : 4000)]));

export async function createCollectionAction(_prev: CreateState, f: FormData): Promise<CreateState> {
  const account = await getAccount();
  if (!account) redirect(`/signin?${new URLSearchParams({ back: "/collect/new" })}`);
  if (!(await allow(`collect-new:${clientIp(await headers())}`, 20, 3600))) return { error: "Lots of collections made from here in the last hour. Wait a bit and try again.", values: typed(f) };
  let name = account.name;
  if (!cleanNames([name])[0]) {
    name = cleanNames([field(f, "yourName")])[0] ?? "";
    if (!name) return { error: "Add your name, so people know who’s collecting.", values: typed(f) };
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
    contacts: field(f, "contacts").slice(0, 60_000),
    friends: f.getAll("friends").map(String).slice(0, 300),
  });
  if (!r.ok) return { error: r.error, values: typed(f) };
  const notes = r.notify;
  if (notes.length) after(() => deliverNotes(notes));
  redirect(`/c/${r.code}?new=1`);
}

// "I've paid": from the shared link, no sign-up needed.
export async function markPaidAction(f: FormData) {
  const code = cleanCode(field(f, "code"));
  if (!code) redirect("/");
  const back = (q: Record<string, string>) => `/c/${code}?${new URLSearchParams(q)}`;
  if (!(await allow(`collect-pay:${clientIp(await headers())}`, 150, 3600))) redirect(back({ error: "Lots of ticks from here in the last hour. Wait a bit and try again." }));
  const key = await payerKey(true);
  const entryId = field(f, "entryId");
  const viewer = await getAccount();
  const r = await markPaid(code, { entryId: entryId && entryId !== "new" ? entryId : undefined, name: field(f, "name"), amount: field(f, "amount"), viewerAccountId: viewer?.id }, key);
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

const KINDS = ["confirm", "unconfirm", "remove", "cash", "add", "nudge", "close", "reopen", "delete"] as const;
type Kind = (typeof KINDS)[number];

export async function organiserActionForm(f: FormData) {
  const code = cleanCode(field(f, "code"));
  const account = await getAccount();
  if (!code) redirect("/");
  if (!account) redirect(`/signin?${new URLSearchParams({ back: `/c/${code}` })}`);
  const kind = field(f, "kind") as Kind;
  if (!KINDS.includes(kind)) redirect(`/c/${code}`);
  const entryId = field(f, "entryId") || undefined;
  const r = await organiserAction(code, account.id, { kind, entryId, names: field(f, "names"), contacts: field(f, "contacts").slice(0, 60_000), friends: f.getAll("friends").map(String).slice(0, 300) });
  if (!r.ok) redirect(`/c/${code}?${new URLSearchParams({ error: r.error })}`);
  // A reminder inside Loopin: at most one per person every 6 hours. Counted only
  // once we know it's the organiser (entry ids are on the public page).
  if (kind === "nudge" && !(await allow(`collect-nudge:${entryId}`, 1, 6 * 3600))) redirect(`/c/${code}?${new URLSearchParams({ error: "You reminded them in the last few hours. Give it a little time." })}`);
  const notes = r.notify ?? [];
  if (notes.length) after(() => deliverNotes(notes));
  if (kind === "delete") redirect("/?collection=deleted");
  redirect(`/c/${code}${kind === "add" ? "?added=1" : kind === "nudge" ? "?reminded=1" : ""}`);
}

// For the organiser (in Alerts and on their phones): "Ravi says they paid ₹300".
async function tellOrganiser(code: string, entryId: string) {
  const c = await loadCollection(code);
  const e = c?.entries.find((x) => x.id === entryId);
  if (!c || !e) return;
  await deliverNotes([
    { accountIds: [c.accountId], kind: "collect_ticked", title: c.title, body: `${e.name} says they paid ${formatMoney(e.amount, c.currency)}. Tap to check it off.`, url: `/c/${c.code}`, tag: `collect:${c.code}` },
  ]);
}

// Alerts → "Collection notifications on this phone" on or off.
export async function setCollectPush(f: FormData) {
  const account = await getAccount();
  if (!account) redirect("/signin?back=/notifications");
  await db.account.update({ where: { id: account.id }, data: { collectPush: field(f, "on") === "1" } });
  redirect("/notifications");
}
