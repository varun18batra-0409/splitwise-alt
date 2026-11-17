import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getMemberships } from "@/lib/identity";
import { searchPeople } from "@/lib/invites";
import { allow, clientIp } from "@/lib/rate-limit";

// People search on "Add people". A plain GET, not a server action: Next.js runs
// server actions one at a time in the same queue as screen changes, so each
// search used to wait behind (and hold up) everything else. A GET can also be
// cancelled when the next letter is typed.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const groupId = url.searchParams.get("g") ?? "";
  const q = url.searchParams.get("q") ?? "";
  const memberships = await getMemberships();
  const myId = memberships[groupId];
  const none = () => Response.json([], { headers: { "Cache-Control": "private, no-store" } });
  if (!myId || q.trim().length < 2) return none();
  // Only real members of this group can search from it.
  const [member, allowed] = await Promise.all([
    db.member.findFirst({ where: { id: myId, groupId, leftAt: null }, select: { id: true } }),
    allow(`find:${clientIp(await headers())}`, 240, 3600),
  ]);
  if (!member) return none();
  // Busy is not the same as "nobody found": 429, so the screen can say so and not remember it as an answer.
  if (!allowed) return Response.json([], { status: 429, headers: { "Cache-Control": "private, no-store" } });
  return Response.json(await searchPeople(memberships, groupId, q), { headers: { "Cache-Control": "private, no-store" } });
}
