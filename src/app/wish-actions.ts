"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "@/lib/fresh-redirect";
import { getAccount, setMyMemberId } from "@/lib/identity";
import { SITE_URL } from "@/lib/site";
import { cleanKey } from "@/lib/once";
import { allow } from "@/lib/rate-limit";
import { cleanCountries, cleanCountry, cleanScope } from "@/lib/wishes";

// "Want to go". Every action takes only country codes and friend ids; the owner is always the signed-in account (never a form field).
// Who can see what is decided in src/lib/wishes-db.ts, not here.

const WANT = "/passport?tab=want";
const back = (q: Record<string, string> = {}, hash = "") => `${WANT}${Object.keys(q).length ? `&${new URLSearchParams(q)}` : ""}${hash}`;

async function me() {
  const a = await getAccount();
  if (!a) redirect("/signin?back=/passport%3Ftab%3Dwant");
  return a;
}

// "Add a place": the countries ticked in the picker.
export async function addWishesAction(f: FormData) {
  const a = await me();
  const picked = cleanCountries(f.getAll("country"));
  if (!picked.length) redirect(back({ error: "Tick at least one country." }));
  const { addWishes } = await import("@/lib/wishes-db");
  const r = await addWishes(a.id, picked);
  redirect(back({ wished: String(r.added), ...(r.full ? { full: "1" } : {}) }, "#list"));
}

export async function removeWishAction(f: FormData) {
  const a = await me();
  const { removeWish } = await import("@/lib/wishes-db");
  await removeWish(a.id, f.get("country"));
  redirect(back({}, "#list"));
}

// "Share": one country or the whole list, with exactly the friends ticked (unticked = stop sharing).
export async function shareWishesAction(f: FormData) {
  const a = await me();
  if (!(await allow(`wish-share:${a.id}`, 30, 3600))) redirect(back({ error: "You’ve changed sharing a lot just now. Try again in a bit." }));
  const scope = cleanScope(f.get("scope"));
  if (!scope) redirect(back({ error: "Pick what to share." }));
  const friends = f.getAll("friend").map((v) => String(v).slice(0, 40));
  const { setShares } = await import("@/lib/wishes-db");
  const r = await setShares(a.id, scope, friends);
  if (!r.ok) redirect(back({ error: r.error ?? "Couldn’t change sharing." }));
  redirect(back({ shared: String(r.shared) }, "#list"));
}

// "Plan together": a new trip group named after the country, your friend invited the normal way.
export async function planTogetherAction(f: FormData) {
  const a = await me();
  const country = cleanCountry(f.get("country"));
  const friendId = String(f.get("friendId") ?? "").slice(0, 40);
  if (!country || !friendId) redirect(WANT);
  if (!(await allow(`plan-together:${a.id}`, 5, 86_400))) redirect(back({ error: "You’ve planned a few trips today. Try again tomorrow." }));
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = process.env.VERCEL_ENV === "production" ? SITE_URL : `${proto}://${host}`;
  const { planTogether } = await import("@/lib/wishes-db");
  const r = await planTogether(a, friendId, country, { key: cleanKey(f.get("rid")), origin, later: (job) => after(job) });
  if (!r.ok) redirect(back({ error: r.error }));
  await setMyMemberId(r.groupId, r.memberId);
  redirect(`/groups/${r.groupId}`);
}
