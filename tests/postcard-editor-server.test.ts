import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The postcard editor's server rules, through the REAL send action and a stand-in for Vercel Blob (an in-memory shelf of files):
//   - the shape of the card (format, fit, photo size): unknown values are the original, and one side holds 160 characters
//   - reusing a photo: only the person who uploaded it
//   - "Your uploads": only your own, newest first, 8
//   - "My moments": only your own moments from groups you are still in, copied onto the card at send time
//   - deleting an account removes the photos it uploaded
// The harness (mocked blob, headers, redirect and session) is the one in photo-storage-e2e.test.ts. Nothing here touches real storage.

const blob = vi.hoisted(() => ({
  files: new Map<string, { bytes: Uint8Array; type: string }>(),
  putKeys: [] as string[],
}));
vi.mock("@vercel/blob", () => ({
  put: async (key: string, body: Uint8Array, opts: { contentType?: string }) => {
    blob.files.set(key, { bytes: new Uint8Array(body), type: opts.contentType ?? "" });
    blob.putKeys.push(key);
    return { url: `https://blob.example/${key}` };
  },
  get: async (key: string) => {
    const f = blob.files.get(key);
    return f ? { statusCode: 200, stream: new Response(f.bytes as unknown as BodyInit).body } : null;
  },
  del: async (keys: string | string[]) => {
    for (const k of Array.isArray(keys) ? keys : [keys]) blob.files.delete(k);
  },
}));

const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test", origin: "http://loopin.test", "x-forwarded-for": `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  RedirectType: { replace: "replace", push: "push" },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("@/lib/push", async (orig) => ({ ...(await orig<typeof import("@/lib/push")>()), sendPushTo: async () => 0 }));

const { db } = await import("@/lib/db");
const { encodeSession, today } = await import("@/lib/session");
const { deleteAccount } = await import("@/lib/auth");
const { storePhoto } = await import("@/lib/photo-store");
const { myPostcardUploads, ownsPostcardPhoto } = await import("@/lib/postcards/uploads");
const { myMomentsForPostcard, myMomentForPostcard, removeMoment } = await import("@/lib/moments-db");
const postcardPhotoRoute = await import("@/app/api/postcard-photo/[id]/route");
const postcardActions = await import("@/app/postcard-actions");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const saved = { VERCEL: process.env.VERCEL, BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN };
const groupIds: string[] = [];
const accountIds: string[] = [];
const photoIds: string[] = [];
let counter = 0;

// A small but complete JPEG. Different `tag` = different bytes. The metadata stripper keeps it as it is.
const jpeg = (tag: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, tag & 0x7f, (tag >> 7) & 0x7f, 0xff, 0xd9]);
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const body = async (res: Response) => new Uint8Array(await res.arrayBuffer());

type Person = { id: string; name: string };
async function person(label: string): Promise<Person> {
  const a = await db.account.create({ data: { email: `pe-${label}-${++counter}-${stamp}@example.test`, name: label } });
  accountIds.push(a.id);
  return { id: a.id, name: label };
}
const P = {} as { ann: Person; bea: Person; cal: Person };
const as = async (p: Person | null) => {
  state.cookie = p ? await encodeSession({ m: {}, a: p.id, v: 0, t: today() }) : "";
};

// A trip group with these people in it. `odd` changes one person's row (left, removed) or the group (deleted).
type Row = { who: Person; name: string; leftAt?: Date; removedAt?: Date };
async function trip(label: string, rows: Row[], o: { deleted?: boolean } = {}) {
  const n = ++counter;
  const g = await db.group.create({
    data: {
      name: `Cards ${label} ${n} ${stamp}`,
      inviteCode: `pe-${label}-${n}-${stamp}`,
      currency: "INR",
      type: "trip",
      deletedAt: o.deleted ? ago(1) : null,
      members: { create: rows.map((r, i) => ({ name: r.name, accountId: r.who.id, claimedAt: new Date(2026, 0, 1 + i), ...(r.leftAt ? { leftAt: r.leftAt } : {}), ...(r.removedAt ? { leftAt: r.removedAt, removedAt: r.removedAt, removedById: "admin" } : {}) })) },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const member = (name: string) => g.members.find((x) => x.name === name)!.id;
  return { id: g.id, member };
}

// A moment put straight in the database (its photo in the row).
async function moment(g: { id: string; member: (n: string) => string }, by: Person, name: string, tag: number, caption = "") {
  const bytes = jpeg(tag);
  const row = await db.moment.create({ data: { groupId: g.id, authorId: g.member(name), authorAccountId: by.id, caption, type: "image/jpeg", width: 1600, height: 1200, data: bytes, thumbData: bytes } });
  return { id: row.id, bytes };
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const getPostcardPhoto = async (as_: Person, id: string) => {
  await as(as_);
  return postcardPhotoRoute.GET(new Request("http://loopin.test/p"), ctx(id));
};

// Sends a card through the real action, as the form would. Returns where it went next and the cards it made.
async function send(from: Person, to: Person[], extra: Record<string, string> = {}) {
  await as(from);
  const before = new Set((await db.postcard.findMany({ where: { fromId: from.id }, select: { id: true } })).map((c) => c.id));
  const f = new FormData();
  for (const t of to) f.append("to", t.id);
  f.set("message", "Wish you were here");
  f.set("front", "print:beach");
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  let went = "";
  try {
    await postcardActions.sendPostcardAction(f);
  } catch (err) {
    const m = /^NEXT_REDIRECT (.*)$/.exec(String((err as Error).message));
    if (!m) throw err;
    went = m[1];
  }
  const cards = (await db.postcard.findMany({ where: { fromId: from.id }, orderBy: { createdAt: "desc" } })).filter((c) => !before.has(c.id));
  for (const c of cards) if (c.photoId) photoIds.push(c.photoId);
  return { went, cards, sent: /\?sent=/.test(went), refused: /[?&]error=/.test(went), error: decodeURIComponent((/[?&]error=([^&]*)/.exec(went)?.[1] ?? "").replace(/\+/g, " ")) };
}
// Sends a card with a new own photo.
const sendOwn = (from: Person, to: Person[], tag: number, extra: Record<string, string> = {}) => send(from, to, { front: "own", photo: b64(jpeg(tag)), ...extra });

const counts = async () => ({ cards: await db.postcard.count(), photos: await db.postcardPhoto.count(), puts: blob.putKeys.length });

async function leftovers() {
  const keys = [...blob.files.keys()];
  const used = new Set((keys.length ? await db.postcardPhoto.findMany({ where: { blobKey: { in: keys } }, select: { blobKey: true } }) : []).map((x) => x.blobKey));
  const everKey = [...new Set(blob.putKeys)];
  const rows = everKey.length ? await db.postcardPhoto.findMany({ where: { blobKey: { in: everKey } }, select: { blobKey: true } }) : [];
  return {
    orphanFiles: keys.filter((k) => !used.has(k)),
    orphanRows: rows.map((x) => x.blobKey).filter((k) => !blob.files.has(k)),
    stillToDelete: await db.blobTrash.count({ where: { key: { in: everKey } } }),
  };
}
const CLEAN = { orphanFiles: [], orphanRows: [], stillToDelete: 0 };

beforeAll(async () => {
  process.env.VERCEL = "1";
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
  P.ann = await person("Ann");
  P.bea = await person("Bea");
  P.cal = await person("Cal");
});
beforeEach(() => {
  blob.files.clear();
  blob.putKeys.length = 0;
  state.cookie = "";
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterAll(async () => {
  vi.restoreAllMocks();
  state.cookie = "";
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mine = (await db.moment.findMany({ where: { groupId: { in: groupIds } }, select: { id: true } })).map((m) => m.id);
  await db.report.deleteMany({ where: { kind: "moment", targetId: { in: mine } } });
  await db.moment.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.postcardPhoto.deleteMany({ where: { OR: [{ id: { in: photoIds } }, { accountId: { in: accountIds } }] } });
  await db.blobTrash.deleteMany({ where: { key: { in: [...new Set(blob.putKeys)] } } });
  await db.requestKey.deleteMany({ where: { key: { contains: stamp } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.accountNote.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("the shape of the card: format, fit and photo size", () => {
  it("a form with no format, fit or size saves a classic, full, small card; made-up values do too", async () => {
    await trip("shape", [{ who: P.ann, name: "Ann" }, { who: P.bea, name: "Bea" }]);
    const plain = await send(P.ann, [P.bea]);
    expect(plain.sent, plain.went).toBe(true);
    expect(plain.cards[0]).toMatchObject({ format: "classic", fit: "full", photoSize: "small" });
    const evil = await send(P.ann, [P.bea], { format: "evil", fit: "evil", photoSize: "evil" });
    expect(evil.sent, evil.went).toBe(true);
    expect(evil.cards[0]).toMatchObject({ format: "classic", fit: "full", photoSize: "small" });
    const real = await send(P.ann, [P.bea], { format: "classic", fit: "taped", photoSize: "large" });
    expect(real.cards[0]).toMatchObject({ format: "classic", fit: "taped", photoSize: "large" });
  });

  it("one side holds 160 characters: 161 is refused before anything is stored; 160 (even with spaces round it) and a classic 300 are saved", async () => {
    await trip("limit", [{ who: P.ann, name: "Ann" }, { who: P.bea, name: "Bea" }]);
    const before = await counts();
    const long = await sendOwn(P.ann, [P.bea], 11, { format: "oneside", message: "a".repeat(161) });
    expect(long.refused).toBe(true);
    expect(long.error).toContain("A one-side card holds up to 160 characters");
    expect(await counts()).toEqual(before); // no postcard, no photo row, no file uploaded

    const exact = await sendOwn(P.ann, [P.bea], 12, { format: "oneside", message: "a".repeat(160) });
    expect(exact.sent, exact.went).toBe(true);
    expect(exact.cards[0].message.length).toBe(160);
    const padded = await send(P.ann, [P.bea], { format: "oneside", message: `   ${"b".repeat(160)}   ` });
    expect(padded.sent, padded.went).toBe(true);
    expect(padded.cards[0].message).toBe("b".repeat(160)); // trimmed first, never cut
    const classic = await send(P.ann, [P.bea], { message: "c".repeat(300) });
    expect(classic.sent, classic.went).toBe(true);
    expect(classic.cards[0].message.length).toBe(300);
  });

  it("a one-side card keeps no words on the front and no address", async () => {
    await trip("noaddr", [{ who: P.ann, name: "Ann" }, { who: P.bea, name: "Bea" }]);
    const r = await send(P.ann, [P.bea], { format: "oneside", words: "Goa", addr0: "Bea", addr1: "Flat 4B", message: "Hi" });
    expect(r.cards[0]).toMatchObject({ format: "oneside", words: "", address: "[]" });
    const classic = await send(P.ann, [P.bea], { words: "Goa", addr0: "Bea" });
    expect(classic.cards[0].words).toBe("Goa");
    expect(JSON.parse(classic.cards[0].address)[0]).toBe("Bea");
  });
});

describe("reusing a photo: only the person who uploaded it", () => {
  it("a recipient, a stranger and a photo set to someone else cannot reuse it; the uploader can, with no new row or file", async () => {
    await trip("reuse", [{ who: P.ann, name: "Ann" }, { who: P.bea, name: "Bea" }]);
    await trip("reuse2", [{ who: P.ann, name: "Ann" }, { who: P.cal, name: "Cal" }]);
    const first = await sendOwn(P.bea, [P.ann], 21);
    expect(first.sent, first.went).toBe(true);
    const photo = first.cards[0].photoId;
    expect((await db.postcardPhoto.findUniqueOrThrow({ where: { id: photo } })).accountId).toBe(P.bea.id);

    let before = await counts();
    const byAnn = await send(P.ann, [P.bea], { front: "own", reusePhoto: photo }); // Ann was only sent it
    expect(byAnn.refused).toBe(true);
    const byCal = await send(P.cal, [P.ann], { front: "own", reusePhoto: photo });
    expect(byCal.refused).toBe(true);
    expect(await counts()).toEqual(before);

    const byBea = await send(P.bea, [P.ann], { front: "own", reusePhoto: photo });
    expect(byBea.sent, byBea.went).toBe(true);
    expect(byBea.cards[0].photoId).toBe(photo);
    before = { ...before, cards: before.cards + 1 };
    expect(await counts()).toEqual(before); // no new photo row, no new file

    // An older photo (from before owners were kept) on her own card: she may use it again.
    const older = await sendOwn(P.bea, [P.ann], 22);
    await db.postcardPhoto.update({ where: { id: older.cards[0].photoId }, data: { accountId: "" } });
    const again = await send(P.bea, [P.ann], { front: "own", reusePhoto: older.cards[0].photoId });
    expect(again.sent, again.went).toBe(true);

    // A photo whose owner was set (by hand) to someone else, even on a card Ann sent herself: refused.
    const hers = await sendOwn(P.ann, [P.bea], 23);
    await db.postcardPhoto.update({ where: { id: hers.cards[0].photoId }, data: { accountId: P.bea.id } });
    const swapped = await send(P.ann, [P.bea], { front: "own", reusePhoto: hers.cards[0].photoId });
    expect(swapped.refused).toBe(true);
    expect(await ownsPostcardPhoto(P.ann.id, hers.cards[0].photoId)).toBe(false);
    // A made-up id is refused too.
    expect(await ownsPostcardPhoto(P.ann.id, "../x")).toBe(false);
    expect(await ownsPostcardPhoto(P.ann.id, "")).toBe(false);
  });
});

describe("Your uploads", () => {
  it("lists only your own, 8 different photos, newest first; never someone else's or ones you were only sent", async () => {
    // Fresh people, so nothing sent in the other stories shows up here.
    const ann = await person("Uma");
    const bea = await person("Ben");
    const cal = await person("Cass");
    await trip("uploads", [{ who: ann, name: "Uma" }, { who: bea, name: "Ben" }]);
    await trip("uploads2", [{ who: ann, name: "Uma" }, { who: cal, name: "Cass" }]);
    const base = Date.now() - 20 * 60_000;
    const ids: string[] = [];
    for (let i = 1; i <= 10; i++) {
      // The 5th photo goes to two people: two cards, one photo.
      const r = await sendOwn(ann, i === 5 ? [bea, cal] : [bea], 100 + i, i === 10 ? { place: "Goa" } : {});
      expect(r.sent, r.went).toBe(true);
      expect(r.cards.length).toBe(i === 5 ? 2 : 1);
      expect(new Set(r.cards.map((c) => c.photoId)).size).toBe(1);
      await db.postcard.updateMany({ where: { id: { in: r.cards.map((c) => c.id) } }, data: { createdAt: new Date(base + i * 60_000) } });
      ids.push(r.cards[0].photoId);
    }
    const beas = [await sendOwn(bea, [ann], 201), await sendOwn(bea, [ann], 202)];
    const got = await myPostcardUploads(ann.id);
    expect(got.map((u) => u.id)).toEqual([...ids].reverse().slice(0, 8)); // photos 10 down to 3
    expect(new Set(got.map((u) => u.id)).size).toBe(8);
    for (const b of beas) expect(got.map((u) => u.id)).not.toContain(b.cards[0].photoId);
    expect(got[0]).toEqual({ id: ids[9], url: `/api/postcard-photo/${ids[9]}`, label: "Your upload: Goa" });
    expect(got[1].label).toBe("Your upload: photo");
    // Ben sees his own only, and someone who sent no photo sees nothing.
    expect((await myPostcardUploads(bea.id)).map((u) => u.id).sort()).toEqual(beas.map((b) => b.cards[0].photoId).sort());
    expect(await myPostcardUploads(cal.id)).toEqual([]);
    // A photo that was handed to someone else is not listed for the sender either.
    await db.postcardPhoto.update({ where: { id: ids[9] }, data: { accountId: cal.id } });
    expect((await myPostcardUploads(ann.id)).map((u) => u.id)).not.toContain(ids[9]);
  });
});

describe("My moments", () => {
  it("offers only your own moments from groups you are in now; none of the others", async () => {
    const G = await trip("mom", [{ who: P.ann, name: "Ann" }, { who: P.bea, name: "Bea" }]);
    const left = await trip("mom-left", [{ who: P.ann, name: "Ann", leftAt: ago(3) }, { who: P.bea, name: "Bea" }]);
    const deleted = await trip("mom-del", [{ who: P.ann, name: "Ann" }, { who: P.bea, name: "Bea" }], { deleted: true });
    const removed = await trip("mom-rem", [{ who: P.ann, name: "Ann", removedAt: ago(3) }, { who: P.bea, name: "Bea" }]);
    const M1 = await moment(G, P.ann, "Ann", 301, "The boat");
    const M2 = await moment(G, P.bea, "Bea", 302);
    const M3 = await moment(left, P.ann, "Ann", 303);
    const M4 = await moment(deleted, P.ann, "Ann", 304);
    const M5 = await moment(G, P.ann, "Ann", 305);
    const M6 = await moment(removed, P.ann, "Ann", 306);
    await db.report.create({ data: { reporterId: P.bea.id, kind: "moment", targetId: M5.id, targetAccountId: P.ann.id, reason: "other" } });

    const list = await myMomentsForPostcard(P.ann.id, {});
    expect(list.map((m) => m.id)).toEqual([M1.id]);
    expect(list[0]).toEqual({ id: M1.id, thumb: `/api/moment-photo/${M1.id}?s=t`, full: `/api/moment-photo/${M1.id}?s=f`, label: "The boat" });
    expect((await myMomentsForPostcard(P.bea.id, {})).map((m) => m.id)).toEqual([M2.id]); // Bea's own, never Ann's
    expect(await myMomentsForPostcard(P.cal.id, {})).toEqual([]);

    // The send action takes only M1. Everything else is refused, with no photo row made.
    await trip("mom-send", [{ who: P.ann, name: "Ann" }, { who: P.bea, name: "Bea" }]);
    const before = await counts();
    for (const bad of [M2.id, M3.id, M4.id, M5.id, M6.id, "../x", "nonsense-id"]) {
      const r = await send(P.ann, [P.bea], { front: "own", momentPhoto: bad });
      expect(r.refused, `moment ${bad}`).toBe(true);
      expect(r.error).toContain("That photo didn’t work");
      expect(await myMomentForPostcard(P.ann.id, bad)).toBeNull();
    }
    expect(await counts()).toEqual(before);
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("puts this group's moments first when asked", async () => {
    const A = await trip("first-a", [{ who: P.cal, name: "Cal" }]);
    const B = await trip("first-b", [{ who: P.cal, name: "Cal" }]);
    const older = await moment(A, P.cal, "Cal", 311, "in A");
    const newer = await moment(B, P.cal, "Cal", 312, "in B");
    await db.moment.update({ where: { id: older.id }, data: { createdAt: ago(2) } });
    const plain = (await myMomentsForPostcard(P.cal.id, {})).map((m) => m.id);
    expect(plain.slice(0, 2)).toEqual([newer.id, older.id]);
    const aFirst = (await myMomentsForPostcard(P.cal.id, { groupFirst: A.id })).map((m) => m.id);
    expect(aFirst.slice(0, 2)).toEqual([older.id, newer.id]);
    await db.moment.deleteMany({ where: { id: { in: [older.id, newer.id] } } });
  });

  it("your own moment is copied onto the card: a new photo row owned by you with the same bytes, and it survives deleting the moment", async () => {
    const G = await trip("mom-copy", [{ who: P.ann, name: "Ann" }, { who: P.bea, name: "Bea" }]);
    const M1 = await moment(G, P.ann, "Ann", 321, "Keep this");
    const before = await counts();
    const r = await send(P.ann, [P.bea], { front: "own", momentPhoto: M1.id });
    expect(r.sent, r.went).toBe(true);
    const photo = await db.postcardPhoto.findUniqueOrThrow({ where: { id: r.cards[0].photoId } });
    expect(photo.accountId).toBe(P.ann.id);
    expect(await counts()).toEqual({ cards: before.cards + 1, photos: before.photos + 1, puts: before.puts + 1 });
    expect(same(await body(await getPostcardPhoto(P.ann, photo.id)), M1.bytes)).toBe(true);

    // The moment is deleted: the card keeps its own copy for the sender and the recipient, and a stranger still gets nothing.
    expect(await removeMoment(M1.id)).toBe(true);
    const asAnn = await getPostcardPhoto(P.ann, photo.id);
    expect(asAnn.status).toBe(200);
    expect(same(await body(asAnn), M1.bytes)).toBe(true);
    expect((await getPostcardPhoto(P.bea, photo.id)).status).toBe(200);
    expect((await getPostcardPhoto(P.cal, photo.id)).status).toBe(404);
    expect(await leftovers()).toEqual(CLEAN);
    // The copy now shows in Your uploads.
    expect((await myPostcardUploads(P.ann.id, 50)).map((u) => u.id)).toContain(photo.id);
  });
});

describe("deleting an account removes the photos it uploaded", () => {
  it("both the upload and the copy of a moment are gone, with their files, even one no card uses any more", async () => {
    const dot = await person("Dot");
    const G = await trip("del", [{ who: dot, name: "Dot" }, { who: P.bea, name: "Bea" }]);
    const M = await moment(G, dot, "Dot", 331);
    const up = await sendOwn(dot, [P.bea], 332);
    const copy = await send(dot, [P.bea], { front: "own", momentPhoto: M.id });
    expect(up.sent && copy.sent, `${up.went} ${copy.went}`).toBe(true);
    // A photo of hers that no card uses (a card that was removed): it goes too.
    const lone = await storePhoto("postcard", jpeg(333), "image/jpeg");
    const loneRow = await db.postcardPhoto.create({ data: { data: lone.data, blobKey: lone.blobKey, type: "image/jpeg", accountId: dot.id } });
    const mine = [up.cards[0].photoId, copy.cards[0].photoId, loneRow.id];
    expect(await db.postcardPhoto.count({ where: { id: { in: mine } } })).toBe(3);
    expect(blob.files.size).toBe(3);

    await deleteAccount(dot.id);
    expect(await db.postcardPhoto.count({ where: { id: { in: mine } } })).toBe(0);
    expect(blob.files.size).toBe(0);
    expect(await leftovers()).toEqual(CLEAN);
    // Bea's own things are untouched.
    expect(await db.account.findUnique({ where: { id: P.bea.id } })).not.toBeNull();
    accountIds.splice(accountIds.indexOf(dot.id), 1);
  });
});
