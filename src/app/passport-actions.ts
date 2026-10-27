"use server";

import { redirect } from "@/lib/fresh-redirect";
import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { countryOf } from "@/lib/geo";
import { parseHandPlaces } from "@/lib/passport";

const field = (f: FormData, k: string) => String(f.get(k) ?? "");

// "Places I've been": countries from before Loopin, as many as you tick at once.
export async function addPlacesAction(f: FormData) {
  const a = await getAccount();
  if (!a) redirect("/signin?back=/passport");
  const picked = [...new Set(f.getAll("country").map((v) => String(v).toUpperCase()).filter((c) => countryOf(c)))].slice(0, 300);
  if (!picked.length) redirect(`/passport?${new URLSearchParams({ error: "Tick at least one country." })}#been`);
  const list = parseHandPlaces(a.places);
  const before = list.length;
  for (const c of picked) if (!list.some((p) => p.c === c)) list.push({ c });
  await db.account.update({ where: { id: a.id }, data: { places: JSON.stringify(list.slice(0, 300)) } });
  redirect(`/passport?added=${list.length - before}#been`);
}

export async function removePlaceAction(f: FormData) {
  const a = await getAccount();
  if (!a) redirect("/signin?back=/passport");
  const c = field(f, "country").toUpperCase();
  const list = parseHandPlaces(a.places).filter((p) => p.c !== c);
  await db.account.update({ where: { id: a.id }, data: { places: JSON.stringify(list) } });
  redirect("/passport#been");
}

// Home country: where your city stamps go (trips abroad get a country stamp).
export async function setHomeCountryAction(f: FormData) {
  const a = await getAccount();
  if (!a) redirect("/signin?back=/passport");
  const c = field(f, "country").toUpperCase();
  await db.account.update({ where: { id: a.id }, data: { homeCountry: countryOf(c) ? c : "" } });
  redirect("/passport");
}

// Who can see your passport: people you share a group with, or only you.
export async function setPassportShareAction(f: FormData) {
  const a = await getAccount();
  if (!a) redirect("/signin?back=/passport");
  const v = field(f, "share") === "private" ? "private" : "groups";
  await db.account.update({ where: { id: a.id }, data: { passportShare: v } });
  redirect(`/passport?shared=${v}#who`);
}

// "Nudge Ravi": a friend's passport is empty, so ask them (in their Alerts only:
// no push, no email) to add where they've been. Once every 30 days per pair.
export async function nudgePassportAction(f: FormData) {
  const a = await getAccount();
  if (!a) redirect("/signin?back=/passport/friends");
  const to = field(f, "accountId");
  const back = `/passport/friends/${encodeURIComponent(to)}`;
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(to) || to === a.id) redirect("/passport/friends");
  const { canSeePassport } = await import("@/lib/passport-db");
  const r = await canSeePassport(a.id, to);
  if (!r.ok) redirect(back);
  const { allow } = await import("@/lib/rate-limit");
  if (!(await allow(`passport-nudge:${a.id}:${to}`, 1, 30 * 86_400))) redirect(`${back}?${new URLSearchParams({ error: "You nudged them recently. Give it a few weeks." })}`);
  const me = (a.name || "A friend").trim().split(/\s+/)[0];
  await db.accountNote.create({
    data: { accountId: to, kind: "passport_nudge", title: `${me} wants to see where you’ve been 🌍`, body: "Add the countries you’ve visited to your trip passport", url: "/passport#been" },
  });
  redirect(`${back}?nudged=1`);
}
