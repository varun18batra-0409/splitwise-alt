"use server";

import { redirect } from "@/lib/fresh-redirect";
import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { countryOf } from "@/lib/geo";
import { parseHandPlaces } from "@/lib/passport";

const field = (f: FormData, k: string) => String(f.get(k) ?? "");

// "Places I've been": a country (and a city, if you like) from before Loopin.
export async function addPlaceAction(f: FormData) {
  const a = await getAccount();
  if (!a) redirect("/signin?back=/passport");
  const c = field(f, "country").toUpperCase();
  if (!countryOf(c)) redirect(`/passport?${new URLSearchParams({ error: "Pick a country from the list." })}`);
  const city = field(f, "city").replace(/\s+/g, " ").trim().slice(0, 30);
  const list = parseHandPlaces(a.places);
  if (!list.some((p) => p.c === c && (p.city ?? "").toLowerCase() === city.toLowerCase())) list.push({ c, ...(city ? { city } : {}) });
  await db.account.update({ where: { id: a.id }, data: { places: JSON.stringify(list.slice(-200)) } });
  redirect("/passport?added=1#been");
}

export async function removePlaceAction(f: FormData) {
  const a = await getAccount();
  if (!a) redirect("/signin?back=/passport");
  const c = field(f, "country").toUpperCase();
  const city = field(f, "city").toLowerCase();
  const list = parseHandPlaces(a.places).filter((p) => !(p.c === c && (p.city ?? "").toLowerCase() === city));
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
