import { getMemberships } from "@/lib/identity";
import { offlineOn } from "@/lib/offline/words";

// Which person this phone is in each group right now: group id and member id only (no names, phone numbers or emails).
// The phone uses it to show an offline copy or a waiting expense only to the person it belongs to. Asked once per online open,
// and after signing in or out. Never kept by the browser or the hosting.
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  let groups: Record<string, string> = {};
  try {
    groups = await getMemberships();
  } catch {
    // Unreadable cookie = signed out: no groups, so nothing is shown offline until the person signs in again.
  }
  // `signedOut` is answered even with the switch off: a phone that kept things while it was on still clears them at sign-out.
  const signedOut = Object.keys(groups).length === 0;
  if (!offlineOn()) return Response.json({ on: false, groups: {}, signedOut }, { headers });
  return Response.json({ on: true, groups, signedOut, now: new Date().toISOString() }, { headers });
}
