import { getMemberships } from "@/lib/identity";
import { headers } from "next/headers";
import { IntroTour } from "@/components/IntroTour";
import { visitorRegion } from "@/lib/region";

export const metadata = { title: "Take the tour", description: "A one-minute tour of Loopin: split costs with friends, flatmates or your partner.", alternates: { canonical: "/welcome" } };

// "How Loopin works" — the intro tour, any time.
export default async function Welcome() {
  const hasGroups = Object.keys(await getMemberships()).length > 0;
  const { currency, india } = visitorRegion(await headers());
  return hasGroups ? <IntroTour startHref="/" cta="Back to my groups" currency={currency} india={india} /> : <IntroTour currency={currency} india={india} />;
}
