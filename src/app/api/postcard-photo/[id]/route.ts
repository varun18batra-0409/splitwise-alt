import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";

// A postcard's own photo: only for the person who sent it and the people it went to.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getAccount();
  const no = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (!me) return no();
  const card = await db.postcard.findFirst({ where: { photoId: id, OR: [{ fromId: me.id }, { toId: me.id }] }, select: { id: true } });
  if (!card) return no();
  const photo = await db.postcardPhoto.findUnique({ where: { id } });
  if (!photo) return no();
  return new Response(new Uint8Array(photo.data), {
    headers: { "Content-Type": photo.type, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
