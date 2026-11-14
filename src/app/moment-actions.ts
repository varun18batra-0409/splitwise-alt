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
  redirect(`/groups/${m.groupId}?tab=memories&removed=1`);
}

// Tap an emoji to react; tap the same one again to take it back; a different one changes it. Current members only.
export async function reactMomentAction(f: FormData) {
  const m = await loadMomentRow(idOf(f));
  if (!m) redirect("/");
  // Back to where the reaction was made: the big view (keeping "from Home" so its Back still goes home) or the list.
  const from = f.get("from");
  const back = from === "home" ? `/groups/${m.groupId}/moments/${m.id}?from=home` : from === "view" ? `/groups/${m.groupId}/moments/${m.id}` : `/groups/${m.groupId}/moments#m-${m.id}`;
  const viewer = await loadMomentViewer(m.groupId);
  if (!viewer || !canReactToMoment(viewer, m)) redirect(back);
  const emoji = String(f.get("emoji") ?? "");
  if (!isReaction(emoji)) redirect(back);
  if (!(await allow(`mreact:${viewer.memberId}`, 120, 3600))) redirect(back);
  const key = { momentId_memberId: { momentId: m.id, memberId: viewer.memberId } };
  try {
    const had = await db.momentReaction.findUnique({ where: key });
    if (had?.emoji === emoji) await db.momentReaction.deleteMany({ where: { momentId: m.id, memberId: viewer.memberId } });
    else await db.momentReaction.upsert({ where: key, create: { momentId: m.id, memberId: viewer.memberId, emoji }, update: { emoji } });
  } catch (err) {
    // A double tap: the other tap saved this person's reaction a moment ago (one per person per moment), so no error page.
    // Retry once as a change to the emoji chosen here, so when the two taps were different emojis the last choice wins.
    // Anything else is a real problem.
    if ((err as { code?: string })?.code !== "P2002") throw err;
    await db.momentReaction.updateMany({ where: { momentId: m.id, memberId: viewer.memberId }, data: { emoji } });
  }
  redirect(back); // outside the try: a redirect is thrown and must not be swallowed
}

// Operator only, from /stats/reports: remove a reported moment (photo files too) and mark its open reports as dealt with.
// If the author already removed it, the reports are still closed.
export async function removeReportedMomentAction(f: FormData) {
  const me = await getAccount();
  if (!isOwner(me)) redirect("/");
  const id = idOf(f);
  if (!id) redirect("/stats/reports");
  const open = await db.report.findFirst({ where: { kind: "moment", targetId: id, status: "open" }, select: { id: true } });
  if (open) {
    await removeMoment(id, { resolveReports: true }); // also closes its open reports, whether or not the moment is still there
  }
  redirect("/stats/reports");
}
