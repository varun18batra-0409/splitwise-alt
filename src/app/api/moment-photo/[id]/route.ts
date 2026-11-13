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
// Kept on the phone only as "ask first" (no-cache) with an ETag: every time, the access check runs first, and only then can the answer
// be "304 not changed" (so someone removed from the group stops getting the photo, instead of it sitting in their cache for a month).
export const dynamic = "force-dynamic";

// Does an If-None-Match header name this tag? (Several tags, "*", and the weak "W/" prefix are all allowed by the web's rules.)
function tagMatches(header: string | null, tag: string): boolean {
  if (!header) return false;
  return header.split(",").some((t) => {
    const v = t.trim().replace(/^W\//, "");
    return v === "*" || v === tag;
  });
}

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
    // (Not for a deleted group: its photos are shut to everyone until they are erased.)
    if (isOwner(account) && (await db.report.findFirst({ where: { kind: "moment", targetId: row.id, status: "open" }, select: { id: true } }))) {
      const group = await db.group.findUnique({ where: { id: row.groupId }, select: { deletedAt: true } });
      if (group && group.deletedAt === null) {
        allowed = true;
        operator = true;
      }
    }
  }
  if (!allowed) return notFoundResponse();
  const small = new URL(req.url).searchParams.get("s") === "t";
  const etag = `"m-${row.id}-${small ? "t" : "f"}"`;
  // Access is settled above; only now may "not changed" be said (and still nothing is read from storage).
  if (!operator && tagMatches(req.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-cache", Vary: "Cookie", "X-Content-Type-Options": "nosniff" } });
  }
  const p = await db.moment.findUnique({ where: { id: row.id }, select: { type: true, data: true, thumbData: true, blobKey: true, thumbKey: true } });
  if (!p) return notFoundResponse();
  const bytes = await readPhoto(small ? { data: p.thumbData, blobKey: p.thumbKey } : { data: p.data, blobKey: p.blobKey });
  if (!bytes) return notFoundResponse();
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": photoType(bytes) ?? p.type,
      // The person's own phone may keep it but must ask first (the ETag makes that cheap). The operator's look is never kept.
      "Cache-Control": operator ? "private, no-store" : "private, no-cache",
      ...(operator ? {} : { ETag: etag }),
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
