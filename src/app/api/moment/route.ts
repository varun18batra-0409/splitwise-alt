import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { allow, clientIp } from "@/lib/rate-limit";
import { MOMENTS_PER_GROUP, MOMENTS_PER_PERSON_PER_DAY, MOMENT_FULL_MAX, MOMENT_FULL_SIDE, MOMENT_THUMB_MAX, MOMENT_THUMB_SIDE, photoType } from "@/lib/covers";
import { cleanPhoto } from "@/lib/strip-meta";
import { imageSize, isAnimatedWebp } from "@/lib/image-size";
import { flushPhotoDeletes, removePhotos, storePhoto } from "@/lib/photo-store";
import { cleanKey, previousResult } from "@/lib/once";
import { canAddMoment, loadMomentViewer, notFoundResponse } from "@/lib/moments-access";
import { saveMoment } from "@/lib/moments-db";
import { cleanCaption, cleanTakenOn } from "@/lib/moments-text";

// Adding a moment: a form with `group`, `full` (the photo, up to 1600 px), `thumb` (a small copy, up to 480 px), `caption`, `takenOn`
// and `rid`. The phone makes both copies small first; the checks here don't trust that.
export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => Response.json({ ok: false, error }, { status });
const SAVE_FAILED = "Couldn’t save that photo. Please try again.";
const BAD_PHOTO = "Pick a photo (JPEG or WebP) that Loopin can read.";

export async function POST(req: Request) {
  const h = await headers();
  // Only from Loopin's own pages (another site can't add a moment in your name).
  const origin = h.get("origin");
  const host = h.get("x-forwarded-host") ?? h.get("host");
  let sameSite = false;
  try {
    sameSite = Boolean(origin && host && new URL(origin).host === host);
  } catch {
    sameSite = false;
  }
  if (!sameSite) return fail("Not allowed.", 403);

  const account = await getAccount();
  if (!account) return fail("Sign in to add a moment.", 401);
  if (Number(h.get("content-length") ?? 0) > 1_400_000) return fail("That photo is too big.", 413);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(BAD_PHOTO, 400);
  }
  const groupId = String(form.get("group") ?? "");
  // The group comes from the form, but only a current, joined member of a trip group gets any further (and it's checked again when saving).
  const viewer = await loadMomentViewer(groupId);
  if (!canAddMoment(viewer) || viewer.accountId !== account.id) return notFoundResponse();

  if (!(await allow(`moment:${account.id}`, 30, 3600)) || !(await allow(`moment-ip:${clientIp(h)}`, 60, 3600))) return fail("Lots of moments from here in the last hour. Try again later.", 429);
  const rid = cleanKey(form.get("rid"));
  const prev = await previousResult(rid);
  if (prev) return Response.json({ ok: true, id: prev });
  if ((await db.moment.count({ where: { groupId } })) >= MOMENTS_PER_GROUP) return fail(`This group has ${MOMENTS_PER_GROUP} moments. Delete an old one to add more.`, 409);
  if ((await db.moment.count({ where: { groupId, authorAccountId: account.id, createdAt: { gt: new Date(Date.now() - 86_400_000) } } })) >= MOMENTS_PER_PERSON_PER_DAY) {
    return fail(`You’ve added ${MOMENTS_PER_PERSON_PER_DAY} moments in the last day. Try again tomorrow.`, 429);
  }

  const group = await db.group.findUnique({ where: { id: groupId }, select: { tripStart: true, tripEnd: true } });
  const caption = cleanCaption(form.get("caption"));
  if (caption === null) return fail("Keep the words to 80 characters or fewer.", 400);
  const takenOn = cleanTakenOn(form.get("takenOn"), group?.tripStart ?? "", group?.tripEnd ?? "");
  if (takenOn === null) return fail("Pick one of the trip’s days, or no day.", 400);

  // The two copies: type, size, dimensions, and hidden details removed (a photo that can't be checked for sure is refused).
  const read = async (f: FormDataEntryValue | null, max: number, side: number) => {
    if (!(f instanceof Blob)) return { ok: false, error: BAD_PHOTO, status: 400 } as const;
    if (f.size > max) return { ok: false, error: "That photo is too big.", status: 413 } as const;
    const raw = new Uint8Array(await f.arrayBuffer());
    const type = photoType(raw);
    if (type !== "image/jpeg" && type !== "image/webp") return { ok: false, error: BAD_PHOTO, status: 415 } as const;
    if (type === "image/webp" && isAnimatedWebp(raw)) return { ok: false, error: BAD_PHOTO, status: 415 } as const; // a moment is a still photo
    const clean = cleanPhoto(raw);
    if (!clean) return { ok: false, error: "We couldn’t check that photo for hidden details (like where it was taken). Try another one.", status: 415 } as const;
    if (clean.length > max) return { ok: false, error: "That photo is too big.", status: 413 } as const;
    const size = imageSize(clean);
    if (!size || Math.max(size.width, size.height) > side) return { ok: false, error: BAD_PHOTO, status: 415 } as const;
    return { ok: true, bytes: clean, type, size } as const;
  };
  const full = await read(form.get("full"), MOMENT_FULL_MAX, MOMENT_FULL_SIDE);
  if (!full.ok) return fail(full.error, full.status);
  const thumb = await read(form.get("thumb"), MOMENT_THUMB_MAX, MOMENT_THUMB_SIDE);
  if (!thumb.ok) return fail(thumb.error, thumb.status);

  // Both files, or neither: with file storage connected, a failed upload is never kept in the database instead.
  const stored: { blobKey: string; data: Uint8Array<ArrayBuffer> }[] = [];
  try {
    stored.push(await storePhoto("moment", full.bytes, full.type, { dbFallback: false }));
    stored.push(await storePhoto("moment", thumb.bytes, thumb.type, { dbFallback: false }));
  } catch (err) {
    console.error("moment: upload failed", String(err).slice(0, 160));
    await removePhotos(stored.map((s) => s.blobKey));
    return fail(SAVE_FAILED, 502);
  }
  const keys = stored.map((s) => s.blobKey);
  let saved: Awaited<ReturnType<typeof saveMoment>>;
  try {
    saved = await saveMoment({
      groupId, memberId: viewer.memberId, accountId: account.id, caption, takenOn, type: full.type, width: full.size.width, height: full.size.height,
      blobKey: stored[0].blobKey, thumbKey: stored[1].blobKey, data: stored[0].data, thumbData: stored[1].data, rid,
    });
  } catch (err) {
    console.error("moment: save failed", String(err).slice(0, 160));
    await removePhotos(keys);
    return fail(SAVE_FAILED, 500);
  }
  if (!saved.ok || saved.duplicate) {
    // Nothing new was saved (removed meanwhile, over a limit, or the same form sent twice): the files just uploaded are not needed.
    await removePhotos(keys);
    if (saved.ok) return Response.json({ ok: true, id: saved.id });
    if (saved.reason === "group-full") return fail(`This group has ${MOMENTS_PER_GROUP} moments. Delete an old one to add more.`, 409);
    if (saved.reason === "slow-down") return fail(`You’ve added ${MOMENTS_PER_PERSON_PER_DAY} moments in the last day. Try again tomorrow.`, 429);
    return notFoundResponse();
  }
  await flushPhotoDeletes();
  return Response.json({ ok: true, id: saved.id });
}
