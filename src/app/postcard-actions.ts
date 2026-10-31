"use server";

import { redirect } from "@/lib/fresh-redirect";
import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { allow } from "@/lib/rate-limit";
import { MAX_PHOTO_BYTES, photoType } from "@/lib/covers";
import { isPrint, isSitePhoto, isStampId, HANDS, LETTERINGS, paperOf, inkOf, toneOf } from "@/lib/postcards/catalog";
import { canSendTo } from "@/lib/postcards/people";
import { deliverNotes } from "@/lib/account-notes";

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
  if (front === "own") {
    const b64 = String(f.get("photo") ?? "");
    const bytes = b64 ? new Uint8Array(Buffer.from(b64, "base64")) : new Uint8Array();
    const type = photoType(bytes);
    if (!type || bytes.length > MAX_PHOTO_BYTES) fail("That photo didn’t work. Try another one.");
    photoId = (await db.postcardPhoto.create({ data: { data: Buffer.from(bytes), type: type! } })).id;
  } else if (front.startsWith("print:")) {
    if (!isPrint(front.slice(6))) front = "print:beach";
  } else if (!(front.startsWith("photo:") && isSitePhoto(front.slice(6)))) {
    front = "print:beach";
  }

  if (!(await allow(`postcard:${me.id}`, 80, 86_400))) fail("That’s a lot of postcards today. Try again tomorrow.");

  const stamp = isStampId(field(f, "stamp", 20)) ? field(f, "stamp", 20) : "t:airmail";
  const hand = HANDS.some((h) => h.id === field(f, "hand", 20)) ? field(f, "hand", 20) : "caveat";
  const lettering = LETTERINGS.some((l) => l.id === field(f, "lettering", 20)) ? field(f, "lettering", 20) : "classic";
  const address = [0, 1, 2].map((i) => field(f, `addr${i}`, 60).trim());
  const groupId = field(f, "groupId", 40);
  const data = {
    fromId: me.id,
    groupId,
    front,
    photoId,
    words: field(f, "words", 40).trim(),
    lettering,
    tone: toneOf(field(f, "tone", 20)).id,
    message,
    hand,
    stamp,
    paper: paperOf(field(f, "paper", 20)),
    ink: inkOf(field(f, "ink", 20)),
    address: JSON.stringify(address),
    place: field(f, "place", 24).trim(),
  };
  const made = await db.$transaction([...to].map((toId) => db.postcard.create({ data: { ...data, toId }, select: { id: true, toId: true } })));

  const sender = me.name.trim().split(/\s+/)[0] || "A friend";
  await deliverNotes(
    made.map((p) => ({
      accountIds: [p.toId],
      kind: "postcard",
      title: `${sender} sent you a postcard`,
      body: data.words ? `Greetings from ${data.words}` : message.slice(0, 80),
      url: `/postcards/${p.id}`,
      tag: `postcard-${p.id}`,
    })),
  );
  redirect(`/postcards/${made[0].id}?sent=${made.length}`);
}
