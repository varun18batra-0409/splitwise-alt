"use server";

import { cleanPhoto } from "@/lib/strip-meta";
import { redirect } from "@/lib/fresh-redirect";
import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { allow } from "@/lib/rate-limit";
import { MAX_PHOTO_BYTES, photoType } from "@/lib/covers";
import { getTimeZone } from "@/lib/tz";
import { cleanLook, cleanSeal, cleanTouches, reactionOf, wordsAtOf, wordsSizeOf } from "@/lib/postcards/looks";
import { headers } from "next/headers";
import { visitorRegion } from "@/lib/region";
import { isPrint, isSitePhoto, isStampId, rareFor, rareOpen, HANDS, LETTERINGS, paperOf, inkOf, toneOf } from "@/lib/postcards/catalog";
import { canSendTo } from "@/lib/postcards/people";
import { deliverNotes } from "@/lib/account-notes";
import { isBlockedEitherWay } from "@/lib/blocks";

const field = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").replace(/\r/g, "").slice(0, max);

// Send a postcard to one or more people you've shared a group with. One copy each, so each
// person's card is theirs (read, kept in their passport). Their phone gets a note in Alerts.
export async function sendPostcardAction(f: FormData) {
  const me = await getAccount();
  const back = `/postcards/new?${new URLSearchParams({ ...(field(f, "groupId") ? { group: field(f, "groupId") } : {}) })}`;
  if (!me) redirect(`/signin?back=${encodeURIComponent(back)}`);
  const fail = (error: string) => redirect(`${back}${back.includes("?") ? "&" : "?"}${new URLSearchParams({ error })}`);

  const to = await canSendTo(me.id, [...new Set(f.getAll("to").map(String))].slice(0, 60));
  if (!to.size) fail("Pick who it’s for.");
  const message = field(f, "message", 600).trim();
  if (!message) fail("Write a few words on the back.");

  // The front: a print, one of Loopin's place photos, or your own photo.
  let front = field(f, "front", 120);
  let photoId = "";
  let newPhoto: { bytes: Uint8Array; type: string } | null = null;
  const reuse = field(f, "reusePhoto", 40);
  if (front === "own" && reuse && !f.get("photo")) {
    // Your own photo from a card you sent before: only if it really was yours.
    const had = await db.postcard.findFirst({ where: { fromId: me.id, photoId: reuse }, select: { id: true } });
    if (!had) fail("That photo didn’t work. Try another one.");
    photoId = reuse;
  } else if (front === "own") {
    const b64 = String(f.get("photo") ?? "");
    const bytes = b64 ? new Uint8Array(Buffer.from(b64, "base64")) : new Uint8Array();
    const type = photoType(bytes);
    if (!type || bytes.length > MAX_PHOTO_BYTES) fail("That photo didn’t work. Try another one.");
    const clean = cleanPhoto(bytes);
    if (!clean) fail("We couldn’t check that photo for hidden details (like where it was taken). Try another one, or a screenshot of it.");
    // Not stored yet: every other check below runs first, so a refused card leaves no photo behind.
    newPhoto = { bytes: clean!, type: type! };
  } else if (front.startsWith("print:")) {
    if (!isPrint(front.slice(6))) front = "print:beach";
  } else if (!(front.startsWith("photo:") && isSitePhoto(front.slice(6)))) {
    front = "print:beach";
  }

  if (!(await allow(`postcard:${me.id}`, 80, 86_400))) fail("That’s a lot of postcards today. Try again tomorrow.");

  let stamp = isStampId(field(f, "stamp", 20)) ? field(f, "stamp", 20) : "t:airmail";
  // A rare stamp only while it's on issue (a card being sent again keeps it if the original had it).
  const home = (me!.homeCountry || visitorRegion(await headers()).country || "IN").toUpperCase();
  if (stamp.startsWith("r:") && !(rareOpen(stamp) && rareFor(stamp, home))) {
    const kept = field(f, "from", 40) ? await db.postcard.findFirst({ where: { id: field(f, "from", 40), fromId: me.id, stamp }, select: { id: true } }) : null;
    if (!kept) stamp = "t:airmail";
  }
  // Sealed until a day you pick (from tomorrow, up to two years ahead): opens at midnight your time.
  let opensAt: Date | null = null;
  const day = field(f, "opensOn", 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const tz = await getTimeZone();
    const noonUtc = new Date(`${day}T12:00:00Z`);
    const offset = new Date(noonUtc.toLocaleString("en-US", { timeZone: tz })).getTime() - new Date(noonUtc.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
    const at = new Date(new Date(`${day}T00:00:00Z`).getTime() - offset);
    const now = Date.now();
    if (Number.isNaN(at.getTime()) || at.getTime() <= now || at.getTime() > now + 2 * 366 * 86_400_000) fail("Pick a day from tomorrow, up to two years ahead.");
    opensAt = at;
  }
  // Every check has passed: only now is a new photo stored.
  let storedKey = "";
  if (newPhoto) {
    const { storePhoto } = await import("@/lib/photo-store");
    const stored = await storePhoto("postcard", newPhoto.bytes, newPhoto.type);
    storedKey = stored.blobKey;
    try {
      photoId = (await db.postcardPhoto.create({ data: { data: stored.data, blobKey: stored.blobKey, type: newPhoto.type } })).id;
    } catch (err) {
      // The file is stored but its row was not made: put its key on the to-delete list and delete it.
      try {
        const { removePhotos } = await import("@/lib/photo-store");
        await removePhotos([storedKey]);
      } catch (cleanErr) {
        console.error("postcard: couldn't remove the unused photo file", String(cleanErr).slice(0, 160));
      }
      throw err;
    }
  }
  const hand = HANDS.some((h) => h.id === field(f, "hand", 20)) ? field(f, "hand", 20) : "caveat";
  const lettering = LETTERINGS.some((l) => l.id === field(f, "lettering", 20)) ? field(f, "lettering", 20) : "classic";
  const address = [0, 1, 2].map((i) => field(f, `addr${i}`, 25).trim());
  const groupId = field(f, "groupId", 40);
  const data = {
    fromId: me.id,
    groupId,
    front,
    photoId,
    words: field(f, "words", 40).trim(),
    lettering,
    look: cleanLook(field(f, "look", 20)),
    wordsAt: wordsAtOf(field(f, "wordsAt", 10)),
    wordsSize: wordsSizeOf(field(f, "wordsSize", 5)),
    touches: cleanTouches(field(f, "touches", 120)),
    seal: cleanSeal(field(f, "seal", 30)),
    signoff: field(f, "signoff", 25).trim(),
    opensAt,
    tone: toneOf(field(f, "tone", 20)).id,
    message,
    hand,
    stamp,
    paper: paperOf(field(f, "paper", 20)),
    ink: inkOf(field(f, "ink", 20)),
    address: JSON.stringify(address),
    place: field(f, "place", 24).trim(),
  };
  let made: { id: string; toId: string }[];
  try {
    made = await db.$transaction([...to].map((toId) => db.postcard.create({ data: { ...data, toId }, select: { id: true, toId: true } })));
  } catch (err) {
    // The cards were not made: a photo stored just for them must not be left behind. But if any postcard
    // does use the photo (the cards were saved and something after that failed), it is never deleted.
    if (newPhoto) {
      try {
        if ((await db.postcard.count({ where: { photoId } })) === 0) {
          await db.postcardPhoto.deleteMany({ where: { id: photoId } });
          const { removePhotos } = await import("@/lib/photo-store");
          await removePhotos([storedKey]); // queued on the to-delete list first, then tried at once
        }
      } catch (cleanErr) {
        console.error("postcard: couldn't remove the unused photo", String(cleanErr).slice(0, 160));
      }
    }
    throw err;
  }

  const sender = me.name.trim().split(/\s+/)[0] || "A friend";
  await deliverNotes(
    made.map((p) => ({
      accountIds: [p.toId],
      kind: "postcard",
      title: opensAt ? `${sender} sent you a sealed postcard` : `${sender} sent you a postcard`,
      body: opensAt ? `It opens on ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(opensAt)}. No peeking.` : data.words ? `Greetings from ${data.words}` : message.slice(0, 80),
      url: `/postcards/${p.id}`,
      tag: `postcard-${p.id}`,
      fromAccountId: me.id,
    })),
  );
  redirect(`/postcards/${made[0].id}?sent=${made.length}`);
}

// The person a postcard went to presses a wax seal back onto it ("Miss you"). The sender hears about it.
export async function reactPostcardAction(f: FormData) {
  const me = await getAccount();
  const id = field(f, "id", 40);
  if (!me) redirect(`/signin?back=/postcards/${id}`);
  const r = reactionOf(field(f, "reaction", 10));
  const p = await db.postcard.findFirst({ where: { id, toId: me.id }, select: { id: true, fromId: true, reaction: true, opensAt: true } });
  if (!p || !r || (p.opensAt && p.opensAt > new Date())) redirect(`/postcards/${id}`);
  // No seal either way once one of them has blocked the other.
  if (await isBlockedEitherWay(me.id, p!.fromId)) redirect(`/postcards/${id}`);
  if (!(await allow(`postcard-seal:${me.id}`, 60, 86_400))) redirect(`/postcards/${id}`);
  await db.postcard.update({ where: { id: p!.id }, data: { reaction: r!.id, reactedAt: new Date() } });
  if (p!.reaction !== r!.id) {
    const who = me.name.trim().split(/\s+/)[0] || "A friend";
    await deliverNotes([{ accountIds: [p!.fromId], kind: "postcard", title: `${who} sealed your postcard`, body: `“${r!.name}”`, url: `/postcards/${p!.id}`, tag: `postcard-seal-${p!.id}`, fromAccountId: me.id }]);
  }
  redirect(`/postcards/${id}?sealed=1`);
}
