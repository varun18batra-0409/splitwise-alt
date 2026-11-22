import { notFound } from "next/navigation";
import { OfflineApp } from "@/components/offline/OfflineApp";
import { offlineOn } from "@/lib/offline/words";

// The one generic offline screen (see components/offline/OfflineApp.tsx). It loads nothing from the server and shows nothing personal,
// so the service worker can keep a copy on the phone. With the OFFLINE_ADD switch off it does not exist (404): nothing is kept,
// so no phone is ever sent here, and today's plain offline message shows instead.
export const dynamic = "force-dynamic";

export default function OfflineAppPage() {
  if (!offlineOn()) notFound();
  return <OfflineApp />;
}
