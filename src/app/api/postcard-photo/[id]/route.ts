import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { canViewPostcard } from "@/lib/blocks";
import { readPhoto } from "@/lib/photo-store";

// A postcard's own photo: only for the person who sent it and the people it went to.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getAccount();
  const no = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (!me) return no();
  // One photo can be on several cards (sent to several people): it shows if any card with it may be opened by this person.
  const cards = await db.postcard.findMany({ where: { photoId: id, OR: [{ fromId: me.id }, { toId: me.id }] }, select: { fromId: true, toId: true }, take: 50 });
  let allowed = false;
  for (const c of cards) if (await canViewPostcard(me.id, c)) allowed = true;
  if (!allowed) return no();
  const photo = await db.postcardPhoto.findUnique({ where: { id } });
  const bytes = photo ? await readPhoto(photo) : null;
  if (!photo || !bytes) return no();
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": photo.type, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
