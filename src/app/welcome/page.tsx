import { getMemberships } from "@/lib/identity";
import { IntroTour } from "@/components/IntroTour";

// "How Loopin works" — the intro tour, any time.
export default async function Welcome() {
  const hasGroups = Object.keys(await getMemberships()).length > 0;
  return hasGroups ? <IntroTour startHref="/" cta="Back to my groups" /> : <IntroTour />;
}
