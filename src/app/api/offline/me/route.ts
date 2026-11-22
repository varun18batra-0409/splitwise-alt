import { headers } from "next/headers";
import { getAccount, getMemberships } from "@/lib/identity";
import { takeLeft } from "@/lib/offline/left-cookie";
import { allow, clientIp } from "@/lib/rate-limit";
import { offlineOn } from "@/lib/offline/words";

// Which person this phone is in each group right now: group id and member id only (no names, phone numbers or emails).
// The phone uses it to show an offline copy or a waiting expense only to the person it belongs to. Asked once per online open,
// and after signing in or out. Never kept by the browser or the hosting.
// `account`: whether a signed-in account is on this phone. `left`: the Sign out / Delete account that this phone asked to clear its offline
// data for has FINISHED (a short-lived note set by that action, read once). The phone wipes on `left`, or on "no account"; an answer that
// says "account" without `left` may simply have left before the sign-out finished, so it is never taken as "still signed in" straight away.
// Anything going wrong (the database busy, say) is a 503, never "signed out": the phone keeps everything hidden and asks again later.
export const dynamic = "force-dynamic";

export async function GET() {
  const noStore = { "Cache-Control": "private, no-store" };
  // A phone asks about once a minute while open; this only stops a script from hammering the database.
  if (!(await allow(`offline-me:${clientIp(await headers())}`, 600, 3600))) return Response.json({ error: "slow down" }, { status: 429, headers: noStore });
  let groups: Record<string, string>;
  let account: boolean;
  let left: boolean;
  try {
    groups = await getMemberships();
    account = Boolean(await getAccount());
    left = await takeLeft();
  } catch {
    return Response.json({ error: "busy" }, { status: 503, headers: noStore });
  }
  if (!offlineOn()) return Response.json({ on: false, groups: {}, account, left }, { headers: noStore });
  return Response.json({ on: true, groups, account, left, now: new Date().toISOString() }, { headers: noStore });
}
