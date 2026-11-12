import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Photo storage from start to finish, with a stand-in for Vercel Blob (an in-memory shelf of files).
//
// No change to the app was needed for this: the app asks for storage only through the "@vercel/blob" package
// (put / get / del), and tests already replace that package (see blob-trash.test.ts). Here the stand-in really keeps
// the files, so uploads, views and deletes can be followed all the way: through the real routes (group picture, bill
// photo, postcard photo), the real postcard action, saveExpense, deleteAccount and the 30-day purge. Nothing touches
// real storage, and nothing in the app's own code is switched by a test flag.
//
// After each story the same three questions are asked (leftovers()):
//   - is any file on the shelf that no row points to?          (an orphan file)
//   - does any row point to a file that is not on the shelf?    (an orphan row)
//   - is anything still on the to-delete list (BlobTrash)?      (a delete not finished)

const blob = vi.hoisted(() => ({
  files: new Map<string, { bytes: Uint8Array; type: string }>(),
  putKeys: [] as string[],
  access: [] as string[],
  gets: 0,
  dels: 0,
  putDown: false,
  delDown: false,
}));
vi.mock("@vercel/blob", () => ({
  put: async (key: string, body: Uint8Array, opts: { contentType?: string; access?: string }) => {
    if (blob.putDown) throw new Error("storage is down");
    blob.files.set(key, { bytes: new Uint8Array(body), type: opts.contentType ?? "" });
    blob.putKeys.push(key);
    blob.access.push(String(opts.access));
    return { url: `https://blob.example/${key}` };
  },
  get: async (key: string) => {
    blob.gets++;
    const f = blob.files.get(key);
    return f ? { statusCode: 200, stream: new Response(f.bytes as unknown as BodyInit).body } : null;
  },
  del: async (keys: string | string[]) => {
    blob.dels++;
    if (blob.delDown) throw new Error("storage is down");
    for (const k of Array.isArray(keys) ? keys : [keys]) blob.files.delete(k);
  },
}));

const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test", origin: "http://loopin.test", "x-forwarded-for": `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }),
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
const { flushPhotoDeletes, storePhoto } = await import("@/lib/photo-store");
const { saveExpense } = await import("@/lib/save-expense");
const { deleteAccount } = await import("@/lib/auth");
const { eraseExpiredGroups } = await import("@/lib/purge");
const groupPhotoRoute = await import("@/app/api/group-photo/[id]/route");
const receiptRoute = await import("@/app/api/receipt/[id]/route");
const receiptUploadRoute = await import("@/app/api/receipt/route");
const postcardPhotoRoute = await import("@/app/api/postcard-photo/[id]/route");
const postcardActions = await import("@/app/postcard-actions");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const saved = { VERCEL: process.env.VERCEL, BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN };
const groupIds: string[] = [];
const accountIds: string[] = [];
const postcardPhotoIds: string[] = [];
let counter = 0;

// A small but complete JPEG (start, JFIF header, scan, end). Different `tag` = different bytes.
// The metadata stripper keeps it exactly as it is, so what is stored equals what is sent.
const jpeg = (tag: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, tag & 0x7f, (tag >> 7) & 0x7f, 0xff, 0xd9]);
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
const body = async (res: Response) => new Uint8Array(await res.arrayBuffer());

type Person = { id: string; name: string };
async function person(label: string): Promise<Person> {
  const a = await db.account.create({ data: { email: `ph-${label}-${++counter}-${stamp}@example.test`, name: label } });
  accountIds.push(a.id);
  return { id: a.id, name: label };
}
const P = {} as { ann: Person; bea: Person; lou: Person; rex: Person; cal: Person };

const as = async (p: Person | null) => {
  state.cookie = p ? await encodeSession({ m: {}, a: p.id, v: 0, t: today() }) : "";
};

// One group: Ann and Bea are in it, Lou left 3 days ago, Rex was removed 3 days ago, Cal has nothing to do with it.
async function world(label: string) {
  const n = ++counter;
  const g = await db.group.create({
    data: {
      name: `Photos ${label} ${n} ${stamp}`,
      inviteCode: `ph-${label}-${n}-${stamp}`,
      currency: "INR",
      members: {
        create: [
          { name: "Ann", accountId: P.ann.id, claimedAt: new Date(2026, 0, 1) },
          { name: "Bea", accountId: P.bea.id, claimedAt: new Date(2026, 0, 2) },
          { name: "Lou", accountId: P.lou.id, claimedAt: new Date(2026, 0, 3), leftAt: ago(3) },
          { name: "Rex", accountId: P.rex.id, claimedAt: new Date(2026, 0, 4), leftAt: ago(3), removedAt: ago(3), removedById: "admin" },
        ],
      },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const m = (name: string) => g.members.find((x) => x.name === name)!.id;
  return { id: g.id, ann: m("Ann"), bea: m("Bea"), lou: m("Lou"), rex: m("Rex") };
}

// ----- the routes, called the way the app calls them -----
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const getGroupPhoto = (gid: string) => groupPhotoRoute.GET(new Request("http://loopin.test/g"), ctx(gid));
const putGroupPhoto = (gid: string, bytes: Uint8Array) => groupPhotoRoute.POST(new Request("http://loopin.test/g", { method: "POST", body: bytes as unknown as BodyInit }), ctx(gid));
const getReceipt = (id: string) => receiptRoute.GET(new Request("http://loopin.test/r"), ctx(id));
const putReceipt = (gid: string, bytes: Uint8Array) => receiptUploadRoute.POST(new Request(`http://loopin.test/api/receipt?group=${gid}`, { method: "POST", body: bytes as unknown as BodyInit }));
const getPostcardPhoto = (id: string) => postcardPhotoRoute.GET(new Request("http://loopin.test/p"), ctx(id));

// Sends a postcard with the sender's own photo through the real action. Returns where it went next.
async function sendCard(from: Person, to: Person[], bytes: Uint8Array, extra: Record<string, string> = {}) {
  await as(from);
  const f = new FormData();
  for (const t of to) f.append("to", t.id);
  f.set("message", "Wish you were here");
  f.set("front", "own");
  f.set("photo", Buffer.from(bytes).toString("base64"));
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  let went = "";
  try {
    await postcardActions.sendPostcardAction(f);
  } catch (err) {
    const m = /^NEXT_REDIRECT (.*)$/.exec(String((err as Error).message));
    if (!m) throw err;
    went = m[1];
  }
  const cards = await db.postcard.findMany({ where: { fromId: from.id, photoId: { not: "" } }, orderBy: { createdAt: "desc" } });
  for (const c of cards) postcardPhotoIds.push(c.photoId);
  return { went, cards };
}

// The three questions asked after every story.
async function leftovers() {
  const keys = [...blob.files.keys()];
  const [g, r, p] = keys.length
    ? await Promise.all([
        db.groupPhoto.findMany({ where: { blobKey: { in: keys } }, select: { blobKey: true } }),
        db.receipt.findMany({ where: { blobKey: { in: keys } }, select: { blobKey: true } }),
        db.postcardPhoto.findMany({ where: { blobKey: { in: keys } }, select: { blobKey: true } }),
      ])
    : [[], [], []];
  const used = new Set([...g, ...r, ...p].map((x) => x.blobKey));
  const everKey = [...new Set(blob.putKeys)];
  const rows = [
    ...(await db.groupPhoto.findMany({ where: { blobKey: { in: everKey } }, select: { blobKey: true } })),
    ...(await db.receipt.findMany({ where: { blobKey: { in: everKey } }, select: { blobKey: true } })),
    ...(await db.postcardPhoto.findMany({ where: { blobKey: { in: everKey } }, select: { blobKey: true } })),
  ];
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
  P.lou = await person("Lou");
  P.rex = await person("Rex");
  P.cal = await person("Cal");
});
beforeEach(() => {
  blob.files.clear();
  blob.putKeys.length = 0;
  blob.access.length = 0;
  blob.gets = 0;
  blob.dels = 0;
  blob.putDown = false;
  blob.delDown = false;
  state.cookie = "";
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterAll(async () => {
  vi.restoreAllMocks();
  state.cookie = "";
  if (saved.VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = saved.VERCEL;
  if (saved.BLOB_READ_WRITE_TOKEN === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = saved.BLOB_READ_WRITE_TOKEN;
  await db.postcardPhoto.deleteMany({ where: { id: { in: postcardPhotoIds } } });
  await db.blobTrash.deleteMany({ where: { key: { in: [...new Set(blob.putKeys)] } } });
  await db.requestKey.deleteMany({ where: { key: { contains: stamp } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.accountNote.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

// ---------------------------------------------------------------------------------------------------------------
describe("group picture", () => {
  it("upload, view, replace: the file is kept private, the old file is deleted, nothing is left over", async () => {
    const w = await world("group-flow");
    await as(P.ann);
    const up = await putGroupPhoto(w.id, jpeg(1));
    expect(up.status).toBe(200);
    expect(await up.json()).toEqual({ ok: true });

    const row = (await db.groupPhoto.findUnique({ where: { groupId: w.id } }))!;
    expect(row.blobKey).toMatch(/^group\//);
    expect(row.data.length).toBe(0); // the bytes are on the shelf, not in the database
    expect(same(blob.files.get(row.blobKey)!.bytes, jpeg(1))).toBe(true);
    expect(blob.access).toEqual(["private"]);

    // Another member sees the same bytes, with a type and a private cache.
    await as(P.bea);
    const view = await getGroupPhoto(w.id);
    expect(view.status).toBe(200);
    expect(view.headers.get("Content-Type")).toBe("image/jpeg");
    expect(view.headers.get("Cache-Control")).toContain("private");
    expect(same(await body(view), jpeg(1))).toBe(true);

    // Replaced by Bea: the new one shows, the old file is gone from the shelf and the list.
    expect((await putGroupPhoto(w.id, jpeg(2))).status).toBe(200);
    const row2 = (await db.groupPhoto.findUnique({ where: { groupId: w.id } }))!;
    expect(row2.blobKey).not.toBe(row.blobKey);
    expect(blob.files.has(row.blobKey)).toBe(false);
    expect([...blob.files.keys()]).toEqual([row2.blobKey]);
    expect(same(await body(await getGroupPhoto(w.id)), jpeg(2))).toBe(true);
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("outsiders, signed-out visitors and people who left can't upload; outsiders and signed-out visitors can't view, and storage isn't even asked", async () => {
    const w = await world("group-refused");
    for (const who of [P.cal, null, P.lou, P.rex]) {
      await as(who);
      expect((await putGroupPhoto(w.id, jpeg(3))).status, who?.name ?? "signed out").toBe(403);
    }
    expect(blob.files.size).toBe(0);
    expect(await db.groupPhoto.count({ where: { groupId: w.id } })).toBe(0);

    await as(P.ann);
    await putGroupPhoto(w.id, jpeg(4));
    blob.gets = 0;
    for (const who of [P.cal, null]) {
      await as(who);
      expect((await getGroupPhoto(w.id)).status, who?.name ?? "signed out").toBe(404);
    }
    expect(blob.gets).toBe(0);

    // A deleted group is hidden from everyone while it waits to be erased.
    await db.group.update({ where: { id: w.id }, data: { deletedAt: new Date() } });
    await as(P.ann);
    expect((await getGroupPhoto(w.id)).status).toBe(404);
  });

  it("people who left or were removed still see the group picture, even one uploaded after they left (the rule as built)", async () => {
    const w = await world("group-leaver");
    await as(P.ann);
    await putGroupPhoto(w.id, jpeg(5)); // uploaded now, after Lou and Rex left 3 days ago
    for (const who of [P.lou, P.rex]) {
      await as(who);
      const res = await getGroupPhoto(w.id);
      expect(res.status, who.name).toBe(200);
      expect(same(await body(res), jpeg(5))).toBe(true);
    }
  });

  it("storage down at upload: the photo is kept in the database and still shows; nothing on the shelf", async () => {
    const w = await world("group-fallback");
    blob.putDown = true;
    await as(P.ann);
    expect((await putGroupPhoto(w.id, jpeg(6))).status).toBe(200);
    const row = (await db.groupPhoto.findUnique({ where: { groupId: w.id } }))!;
    expect(row.blobKey).toBe("");
    expect(same(new Uint8Array(row.data), jpeg(6))).toBe(true);
    expect(blob.files.size).toBe(0);
    expect(same(await body(await getGroupPhoto(w.id)), jpeg(6))).toBe(true);
    expect(await leftovers()).toEqual(CLEAN);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("bill photo", () => {
  const rate = async () => ({ ok: true as const, rate: "1", date: "2026-11-01" });
  const draft = (w: Awaited<ReturnType<typeof world>>, over: { expenseId?: string } = {}) => ({
    groupId: w.id, name: "Dinner", category: "", amount: "1000", currency: "INR", paidById: w.ann, forMode: "everyone" as const,
    selected: [] as string[], onePersonId: "", splitType: "exact" as const, exact: { [w.ann]: "300", [w.bea]: "700" }, percent: {}, paymentMethod: "cash",
    markupChoice: "group" as const, markupCustom: "", rateMode: "auto" as const, manualRate: "", ...over,
  });

  async function uploadAs(who: Person, gid: string, bytes: Uint8Array) {
    await as(who);
    const res = await putReceipt(gid, bytes);
    expect(res.status).toBe(200);
    return ((await res.json()) as { id: string }).id;
  }

  it("upload, view; only members can; outsiders and signed-out visitors get nothing", async () => {
    const w = await world("bill-flow");
    const id = await uploadAs(P.ann, w.id, jpeg(10));
    const row = (await db.receipt.findUnique({ where: { id } }))!;
    expect(row.blobKey).toMatch(/^receipt\//);
    expect(row.data.length).toBe(0);
    expect(row.expenseId).toBe("");
    expect(blob.access).toEqual(["private"]);

    await as(P.bea);
    const view = await getReceipt(id);
    expect(view.status).toBe(200);
    expect(same(await body(view), jpeg(10))).toBe(true);

    blob.gets = 0;
    for (const who of [P.cal, null]) {
      await as(who);
      expect((await getReceipt(id)).status, who?.name ?? "signed out").toBe(404);
    }
    expect((await getReceipt("not a real id")).status).toBe(404);
    expect(blob.gets).toBe(0);

    // Upload is refused for outsiders, signed-out visitors and people who left; the shelf stays as it was.
    const before = blob.files.size;
    for (const who of [P.cal, null, P.lou, P.rex]) {
      await as(who);
      expect((await putReceipt(w.id, jpeg(11))).status, who?.name ?? "signed out").toBe(403);
    }
    expect(blob.files.size).toBe(before);
  });

  it("attached to an expense, then removed: the row and the file are both gone", async () => {
    const w = await world("bill-remove");
    const id = await uploadAs(P.ann, w.id, jpeg(12));
    const first = await saveExpense(draft(w), w.ann, rate, { requestKey: `ph-save-${stamp}-1`, attach: { receiptId: id } });
    if (!first.ok) throw new Error(first.error);
    await as(P.bea);
    expect((await getReceipt(id)).status).toBe(200);
    expect((await db.receipt.findUniqueOrThrow({ where: { id } })).expenseId).toBe(first.id);

    const key = (await db.receipt.findUniqueOrThrow({ where: { id } })).blobKey;
    const gone = await saveExpense(draft(w, { expenseId: first.id }), w.ann, rate, { attach: { receiptId: "remove" } });
    expect(gone.ok).toBe(true);
    await flushPhotoDeletes();
    expect(await db.receipt.count({ where: { id } })).toBe(0);
    expect(blob.files.has(key)).toBe(false);
    expect((await getReceipt(id)).status).toBe(404);
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("a delete that fails stays on the list, waits longer each time, and is retried until it works", async () => {
    const w = await world("bill-retry");
    const id = await uploadAs(P.ann, w.id, jpeg(13));
    const first = await saveExpense(draft(w), w.ann, rate, { requestKey: `ph-save-${stamp}-2`, attach: { receiptId: id } });
    if (!first.ok) throw new Error(first.error);
    const key = (await db.receipt.findUniqueOrThrow({ where: { id } })).blobKey;

    blob.delDown = true;
    await saveExpense(draft(w, { expenseId: first.id }), w.ann, rate, { attach: { receiptId: "remove" } });
    // The row is gone at once; the file is still on the shelf, and its key is on the list: tried once (2 hours until the next try).
    expect(await db.receipt.count({ where: { id } })).toBe(0);
    expect(blob.files.has(key)).toBe(true);
    const t0 = Date.now();
    let item = (await db.blobTrash.findUnique({ where: { key } }))!;
    expect(item.tries).toBe(1);
    expect(item.lastError).toContain("storage is down");
    expect(item.nextAt.getTime()).toBeGreaterThan(t0 + 2 * HOUR - 60_000);
    expect(item.nextAt.getTime()).toBeLessThan(t0 + 2 * HOUR + 60_000);

    // One hour later: not due, storage isn't asked.
    blob.dels = 0;
    expect(await flushPhotoDeletes(50, new Date(t0 + HOUR))).toEqual({ deleted: 0, failed: 0, kept: 0 });
    expect(blob.dels).toBe(0);

    // Three hours later: due, storage still down. Tried twice now; next wait is 4 hours from this try.
    const t3 = t0 + 3 * HOUR;
    expect(await flushPhotoDeletes(50, new Date(t3))).toEqual({ deleted: 0, failed: 1, kept: 0 });
    item = (await db.blobTrash.findUnique({ where: { key } }))!;
    expect(item.tries).toBe(2);
    expect(item.nextAt.getTime()).toBe(t3 + 4 * HOUR);
    expect(blob.files.has(key)).toBe(true);

    // Storage comes back; at the next due time the file goes and the list is empty.
    blob.delDown = false;
    expect(await flushPhotoDeletes(50, new Date(t3 + 4 * HOUR))).toEqual({ deleted: 1, failed: 0, kept: 0 });
    expect(blob.files.has(key)).toBe(false);
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("people who left see bill photos from before they left, and later ones only if their own share is in that expense", async () => {
    const w = await world("bill-leaver");
    // Lou and Rex left 3 days ago.
    const add = async (createdAt: Date, expenseId: string, tag: number) => {
      const s = await storePhoto("receipt", jpeg(tag), "image/jpeg");
      return (await db.receipt.create({ data: { groupId: w.id, expenseId, data: s.data, blobKey: s.blobKey, type: "image/jpeg", createdAt }, select: { id: true } })).id;
    };
    const lateExpense = async (shares: string[]) =>
      (await db.expense.create({ data: { groupId: w.id, description: "Late", amount: 120, splitType: "equal", paidById: w.ann, shares: { create: shares.map((memberId) => ({ memberId, amount: 120 / shares.length })) } } })).id;
    const before = await add(ago(5), "", 20); // taken before they left
    const after = await add(new Date(), "", 21); // taken after they left
    const withoutThem = await add(ago(5), await lateExpense([w.ann, w.bea]), 22); // an old photo on an expense made after they left, not theirs
    const withThem = await add(ago(5), await lateExpense([w.ann, w.lou, w.rex]), 23); // ...on one that has their share

    const status = async (who: Person | null, id: string) => {
      await as(who);
      return (await getReceipt(id)).status;
    };
    for (const who of [P.lou, P.rex]) {
      expect(await status(who, before), `${who.name} before`).toBe(200);
      expect(await status(who, after), `${who.name} after`).toBe(404);
      expect(await status(who, withoutThem), `${who.name} not theirs`).toBe(404);
      expect(await status(who, withThem), `${who.name} theirs`).toBe(200);
    }
    // Members see all four; outsiders and signed-out visitors none.
    for (const id of [before, after, withoutThem, withThem]) {
      expect(await status(P.ann, id)).toBe(200);
      expect(await status(P.cal, id)).toBe(404);
      expect(await status(null, id)).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("postcard photo", () => {
  // A group so the two can send to each other.
  async function together(...people: Person[]) {
    const n = ++counter;
    const g = await db.group.create({
      data: { name: `Cards ${n} ${stamp}`, inviteCode: `pc-${n}-${stamp}`, members: { create: people.map((p) => ({ name: p.name, accountId: p.id, claimedAt: new Date() })) } },
    });
    groupIds.push(g.id);
    return g.id;
  }
  const status = async (who: Person | null, photoId: string) => {
    await as(who);
    return (await getPostcardPhoto(photoId)).status;
  };

  it("send, view: only the sender and the person it went to; nobody else, nobody signed out", async () => {
    const [from, to, other] = [await person("From"), await person("To"), await person("Other")];
    await together(from, to);
    const { went, cards } = await sendCard(from, [to], jpeg(30));
    expect(went).toMatch(/^\/postcards\/[A-Za-z0-9]+\?sent=1$/);
    expect(cards).toHaveLength(1);
    const photo = (await db.postcardPhoto.findUniqueOrThrow({ where: { id: cards[0].photoId } }));
    expect(photo.blobKey).toMatch(/^postcard\//);
    expect(photo.data.length).toBe(0);
    expect(blob.access).toEqual(["private"]);

    for (const who of [from, to]) {
      await as(who);
      const res = await getPostcardPhoto(photo.id);
      expect(res.status, who.name).toBe(200);
      expect(same(await body(res), jpeg(30))).toBe(true);
    }
    blob.gets = 0;
    expect(await status(other, photo.id)).toBe(404);
    expect(await status(P.cal, photo.id)).toBe(404);
    expect(await status(null, photo.id)).toBe(404);
    expect(blob.gets).toBe(0);
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("deleting the account of the person it went to removes the card and its photo, row and file", async () => {
    const [from, to] = [await person("From2"), await person("To2")];
    await together(from, to);
    const { cards } = await sendCard(from, [to], jpeg(31));
    const photoId = cards[0].photoId;
    const key = (await db.postcardPhoto.findUniqueOrThrow({ where: { id: photoId } })).blobKey;
    expect(blob.files.has(key)).toBe(true);

    await deleteAccount(to.id);
    expect(await db.postcard.count({ where: { photoId } })).toBe(0);
    expect(await db.postcardPhoto.count({ where: { id: photoId } })).toBe(0);
    expect(blob.files.has(key)).toBe(false);
    expect(await status(from, photoId)).toBe(404);
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("one photo sent to two people stays until the last card with it is gone", async () => {
    const [from, one, two] = [await person("From3"), await person("One3"), await person("Two3")];
    await together(from, one, two);
    const { cards } = await sendCard(from, [one, two], jpeg(32));
    expect(cards).toHaveLength(2);
    const photoId = cards[0].photoId;
    expect(cards[1].photoId).toBe(photoId);
    expect(blob.files.size).toBe(1); // stored once

    await deleteAccount(one.id);
    expect(await db.postcardPhoto.count({ where: { id: photoId } })).toBe(1);
    expect(await status(from, photoId)).toBe(200);
    expect(await status(two, photoId)).toBe(200);

    await deleteAccount(two.id);
    expect(await status(from, photoId)).toBe(200); // the sender's own card is still there
    expect(blob.files.size).toBe(1);

    await deleteAccount(from.id);
    expect(await db.postcardPhoto.count({ where: { id: photoId } })).toBe(0);
    expect(blob.files.size).toBe(0);
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("deleting the sender's account removes the photo too, and a failed file delete is retried until it works", async () => {
    const [from, to] = [await person("From4"), await person("To4")];
    await together(from, to);
    const { cards } = await sendCard(from, [to], jpeg(33));
    const photoId = cards[0].photoId;
    const key = (await db.postcardPhoto.findUniqueOrThrow({ where: { id: photoId } })).blobKey;

    blob.delDown = true;
    await deleteAccount(from.id);
    // Rows are gone in one step with the key written to the list; the file waits for storage.
    expect(await db.postcardPhoto.count({ where: { id: photoId } })).toBe(0);
    expect(await db.postcard.count({ where: { photoId } })).toBe(0);
    expect(blob.files.has(key)).toBe(true);
    expect((await db.blobTrash.findUniqueOrThrow({ where: { key } })).tries).toBe(1);

    blob.delDown = false;
    await flushPhotoDeletes(50, new Date(Date.now() + 3 * HOUR));
    expect(blob.files.has(key)).toBe(false);
    expect(await leftovers()).toEqual(CLEAN);
  });

  // NOT AS INTENDED (reported, nothing changed): the photo is stored BEFORE the last checks of sending. If the card is
  // then refused (here: an "opens on" day in the past; also "too many postcards today"), the photo row and its file stay,
  // with no card pointing to them and nothing that would ever delete them. Marked `fails`: when this is fixed it will start
  // passing and vitest will say so; then change `it.fails` to `it`.
  it.fails("a refused postcard leaves no photo behind", async () => {
    const [from, to] = [await person("From5"), await person("To5")];
    await together(from, to);
    const { went, cards } = await sendCard(from, [to], jpeg(34), { opensOn: "2020-01-01" });
    try {
      expect(went).toContain("/postcards/new");
      expect(cards).toHaveLength(0);
      expect(blob.files.size).toBe(0); // actually 1 file on the shelf
      expect(await db.postcardPhoto.count({ where: { blobKey: { in: [...blob.putKeys] } } })).toBe(0); // actually 1 row
    } finally {
      await db.postcardPhoto.deleteMany({ where: { blobKey: { in: [...blob.putKeys] } } }); // tidy the throwaway data
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("erasing a group 30 days after it was deleted", () => {
  async function groupWithPhotos(label: string) {
    const w = await world(label);
    await as(P.ann);
    expect((await putGroupPhoto(w.id, jpeg(40))).status).toBe(200);
    const billId = await (async () => ((await (await putReceipt(w.id, jpeg(41))).json()) as { id: string }).id)();
    const keys = [(await db.groupPhoto.findUniqueOrThrow({ where: { groupId: w.id } })).blobKey, (await db.receipt.findUniqueOrThrow({ where: { id: billId } })).blobKey];
    return { ...w, billId, keys };
  }

  it("erases the photos of a group deleted more than 30 days ago, and leaves a group deleted 29 days ago alone", async () => {
    const old = await groupWithPhotos("purge-old");
    const recent = await groupWithPhotos("purge-recent");
    await db.group.update({ where: { id: old.id }, data: { deletedAt: ago(31) } });
    await db.group.update({ where: { id: recent.id }, data: { deletedAt: ago(29) } });
    expect(blob.files.size).toBe(4);

    await eraseExpiredGroups(new Date(), 1000);

    expect(await db.group.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await db.groupPhoto.count({ where: { groupId: old.id } })).toBe(0);
    expect(await db.receipt.count({ where: { groupId: old.id } })).toBe(0);
    for (const k of old.keys) expect(blob.files.has(k), k).toBe(false);

    // Still inside its 30 days: everything is still there, and could still be restored.
    expect(await db.group.findUnique({ where: { id: recent.id } })).not.toBeNull();
    expect(await db.groupPhoto.count({ where: { groupId: recent.id } })).toBe(1);
    expect(await db.receipt.count({ where: { id: recent.billId } })).toBe(1);
    for (const k of recent.keys) expect(blob.files.has(k), k).toBe(true);
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("with storage down the rows go, the keys wait on the list, and the next successful try clears them", async () => {
    const g = await groupWithPhotos("purge-down");
    await db.group.update({ where: { id: g.id }, data: { deletedAt: ago(31) } });
    blob.delDown = true;
    await eraseExpiredGroups(new Date(), 1000);

    expect(await db.group.findUnique({ where: { id: g.id } })).toBeNull();
    expect(await db.groupPhoto.count({ where: { groupId: g.id } })).toBe(0);
    for (const k of g.keys) {
      expect(blob.files.has(k)).toBe(true);
      expect((await db.blobTrash.findUniqueOrThrow({ where: { key: k } })).tries).toBe(1);
    }

    blob.delDown = false;
    await flushPhotoDeletes(50, new Date(Date.now() + 3 * HOUR));
    for (const k of g.keys) expect(blob.files.has(k)).toBe(false);
    expect(await leftovers()).toEqual(CLEAN);
  });
});
