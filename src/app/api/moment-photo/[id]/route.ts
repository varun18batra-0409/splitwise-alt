import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { isOwner } from "@/lib/owner";
import { photoType } from "@/lib/covers";
import { readPhoto } from "@/lib/photo-store";
import { canSeeMoment, loadMomentViewer, notFoundResponse } from "@/lib/moments-access";
import { loadMomentRow } from "@/lib/moments-db";

// A moment's photo (?s=t the small copy, ?s=f the full one). Shown only to people who may see that moment (canSeeMoment), and to the
// operator for a moment with an open report. Every refusal is the same 404, and nothing is read from storage before access is settled.
// The group comes from the moment's own row. A photo never changes, so its id alone is the address.
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await loadMomentRow(id); // no photo bytes
  if (!row) return notFoundResponse();
  const viewer = await loadMomentViewer(row.groupId);
  let allowed = canSeeMoment(viewer, row);
  let operator = false;
  if (!allowed) {
    // The operator may look at a reported moment while its report is open (from /stats/reports), and at nothing else.
    const account = await getAccount();
    if (isOwner(account) && (await db.report.findFirst({ where: { kind: "moment", targetId: row.id, status: "open" }, select: { id: true } }))) {
      allowed = true;
      operator = true;
    }
  }
  if (!allowed) return notFoundResponse();
  const small = new URL(req.url).searchParams.get("s") === "t";
  const p = await db.moment.findUnique({ where: { id: row.id }, select: { type: true, data: true, thumbData: true, blobKey: true, thumbKey: true } });
  if (!p) return notFoundResponse();
  const bytes = await readPhoto(small ? { data: p.thumbData, blobKey: p.thumbKey } : { data: p.data, blobKey: p.blobKey });
  if (!bytes) return notFoundResponse();
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": photoType(bytes) ?? p.type,
      // Kept 30 days on the person's own phone. The operator's look is never kept.
      "Cache-Control": operator ? "private, no-store" : "private, max-age=2592000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
