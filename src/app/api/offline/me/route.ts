import { getAccount, getMemberships } from "@/lib/identity";
import { offlineOn } from "@/lib/offline/words";

// Which person this phone is in each group right now: group id and member id only (no names, phone numbers or emails).
// The phone uses it to show an offline copy or a waiting expense only to the person it belongs to. Asked once per online open,
// and after signing in or out. Never kept by the browser or the hosting.
// `account`: whether a signed-in account is on this phone. After Sign out or Delete account the phone clears what it kept for offline
// only once this says "no account" (an unreadable or absent cookie simply means no account). Anything else going wrong (the database
// busy, say) is a 503, never "signed out": the phone then keeps everything hidden and asks again later.
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  let groups: Record<string, string>;
  let account: boolean;
  try {
    groups = await getMemberships();
    account = Boolean(await getAccount());
  } catch {
    return Response.json({ error: "busy" }, { status: 503, headers });
  }
  if (!offlineOn()) return Response.json({ on: false, groups: {}, account }, { headers });
  return Response.json({ on: true, groups, account, now: new Date().toISOString() }, { headers });
}
