import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { readPhoto } from "@/lib/photo-store";
import { expenseAccess } from "@/lib/left-view-db";
import { tagMatches } from "@/lib/http-cache";

// A bill photo: only for people in its group.
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const no = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return no();
  const r = await db.receipt.findUnique({ where: { id } });
  if (!r) return no();
  const myId = await getMyMemberId(r.groupId);
  const me = myId ? await db.member.findFirst({ where: { id: myId, groupId: r.groupId, group: { deletedAt: null } }, select: { id: true, leftAt: true } }) : null;
  if (!me) return no();
  // Someone who left sees the bills from their time in the group, not newer ones.
  if (me.leftAt && r.createdAt > me.leftAt) return no();
  // ...and only for expenses they may still see (not one the group added without them).
  if (me.leftAt && r.expenseId && (await expenseAccess(r.groupId, me.id, r.expenseId)) === "hidden") return no();
  // Kept on the phone only as "ask first" (no-cache + ETag): the checks above run every time, so someone removed from the group, or a
  // photo taken off an edited expense, stops being served (OP-11). A bill photo never changes, so its id is its version.
  const etag = `"r-${r.id}"`;
  if (tagMatches(req.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-cache", Vary: "Cookie", "X-Content-Type-Options": "nosniff" } });
  }
  const bytes = await readPhoto(r);
  if (!bytes) return no();
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": r.type, "Cache-Control": "private, no-cache", ETag: etag, Vary: "Cookie", "X-Content-Type-Options": "nosniff" },
  });
}
