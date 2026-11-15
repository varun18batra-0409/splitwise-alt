import { getMemberships } from "@/lib/identity";
import { headers } from "next/headers";
import { IntroTour } from "@/components/IntroTour";
import { visitorRegion } from "@/lib/region";
import { photoSet } from "@/lib/places";

export const metadata = { title: "Take the tour", description: "A one-minute tour of Loopin: split costs with friends, flatmates or your partner.", alternates: { canonical: "/welcome" } };

// "How Loopin works" — the intro tour, any time.
export default async function Welcome() {
  const hasGroups = Object.keys(await getMemberships()).length > 0;
  const { currency, india } = visitorRegion(await headers());
  const momentPhoto = photoSet("card-postcard-photo")[0];
  return hasGroups ? <IntroTour startHref="/" cta="Back to my groups" currency={currency} india={india} momentPhoto={momentPhoto} /> : <IntroTour currency={currency} india={india} momentPhoto={momentPhoto} />;
}
