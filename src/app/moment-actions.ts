"use server";

import { db } from "@/lib/db";
import { redirect } from "@/lib/fresh-redirect";
import { getAccount } from "@/lib/identity";
import { isOwner } from "@/lib/owner";
import { allow } from "@/lib/rate-limit";
import { isReaction } from "@/lib/reactions";
import { canDeleteMoment, canReactToMoment, loadMomentViewer } from "@/lib/moments-access";
import { loadMomentRow, removeMoment } from "@/lib/moments-db";

// Deleting, removing and reacting to moments. Every one goes through the same checks as the pages (moments-access.ts); the group
// always comes from the moment's own row, never from the form.

const ID = /^[A-Za-z0-9_-]{6,40}$/;
const idOf = (f: FormData) => {
  const v = String(f.get("momentId") ?? "");
  return ID.test(v) ? v : "";
};

// The author deletes their own; whoever looks after the group removes anyone's. The photo files go with it. Not undoable.
export async function deleteMomentAction(f: FormData) {
  const m = await loadMomentRow(idOf(f));
  if (!m) redirect("/");
  const viewer = await loadMomentViewer(m.groupId);
  if (!canDeleteMoment(viewer, m)) redirect("/");
  await removeMoment(m.id);
  redirect(`/groups/${m.groupId}/moments?removed=1`);
}

// Tap an emoji to react; tap the same one again to take it back; a different one changes it. Current members only.
export async function reactMomentAction(f: FormData) {
  const m = await loadMomentRow(idOf(f));
  if (!m) redirect("/");
  const back = f.get("from") === "view" ? `/groups/${m.groupId}/moments/${m.id}` : `/groups/${m.groupId}/moments#m-${m.id}`;
  const viewer = await loadMomentViewer(m.groupId);
  if (!viewer || !canReactToMoment(viewer, m)) redirect(back);
  const emoji = String(f.get("emoji") ?? "");
  if (!isReaction(emoji)) redirect(back);
  if (!(await allow(`mreact:${viewer.memberId}`, 120, 3600))) redirect(back);
  const key = { momentId_memberId: { momentId: m.id, memberId: viewer.memberId } };
  const had = await db.momentReaction.findUnique({ where: key });
  if (had?.emoji === emoji) await db.momentReaction.deleteMany({ where: { momentId: m.id, memberId: viewer.memberId } });
  else await db.momentReaction.upsert({ where: key, create: { momentId: m.id, memberId: viewer.memberId, emoji }, update: { emoji } });
  redirect(back);
}

// Operator only, from /stats/reports: remove a reported moment (photo files too) and mark its open reports as dealt with.
export async function removeReportedMomentAction(f: FormData) {
  const me = await getAccount();
  if (!isOwner(me)) redirect("/");
  const id = idOf(f);
  if (!id) redirect("/stats/reports");
  const open = await db.report.findFirst({ where: { kind: "moment", targetId: id, status: "open" }, select: { id: true } });
  if (open) {
    await removeMoment(id);
    await db.report.updateMany({ where: { kind: "moment", targetId: id, status: "open" }, data: { status: "resolved", resolvedAt: new Date() } });
  }
  redirect("/stats/reports");
}
