import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";

// A bill photo: only for people in its group.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const no = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return no();
  const r = await db.receipt.findUnique({ where: { id } });
  if (!r) return no();
  const myId = await getMyMemberId(r.groupId);
  const me = myId ? await db.member.findFirst({ where: { id: myId, groupId: r.groupId, group: { deletedAt: null } }, select: { id: true } }) : null;
  if (!me) return no();
  return new Response(new Uint8Array(r.data), {
    headers: { "Content-Type": r.type, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
