import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GPS_MARKER, jpeg, jpegWithGps, webpAnimated, webpAnimatedFlagOnly, webpExtended, webpLossy } from "./helpers/moment-photos";

// Moments from start to finish, through the real routes, with a stand-in for Vercel Blob (an in-memory shelf of files), the way
// tests/photo-storage-e2e.test.ts does for the other photos. Every access rule is checked on the SERVER: the photo address, the upload,
// the actions, the lists. For each refusal the shelf is asked for nothing (`blob.gets` doesn't go up).
//
// After each story the same three questions are asked (leftovers()): is a file on the shelf that no row points to, does a row point to
// a file that isn't there, is anything still on the to-delete list.

const blob = vi.hoisted(() => ({
  files: new Map<string, { bytes: Uint8Array; type: string }>(),
  putKeys: [] as string[],
  access: [] as string[],
  puts: 0,
  failAt: 0, // make the nth put (counted from 1) fail
  gets: 0,
  dels: 0,
  putDown: false,
  delDown: false,
  onPut: null as null | ((key: string) => Promise<void>),
}));
vi.mock("@vercel/blob", () => ({
  put: async (key: string, body: Uint8Array, opts: { contentType?: string; access?: string }) => {
    blob.puts++;
    if (blob.putDown || (blob.failAt && blob.puts === blob.failAt)) throw new Error("storage is down");
    blob.files.set(key, { bytes: new Uint8Array(body), type: opts.contentType ?? "" });
    blob.putKeys.push(key);
    blob.access.push(String(opts.access));
    if (blob.onPut) await blob.onPut(key);
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

const state = vi.hoisted(() => ({ cookie: "", origin: "http://loopin.test" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test", origin: state.origin, "x-forwarded-for": `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }),
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
const { grantValue } = await import("@/lib/identity");
const { flushPhotoDeletes, storePhoto } = await import("@/lib/photo-store");
const { deleteAccount } = await import("@/lib/auth");
const { eraseExpiredGroups } = await import("@/lib/purge");
const { loadMomentViewer, canSeeMoment } = await import("@/lib/moments-access");
const { listMoments, loadMomentCard, momentStrip } = await import("@/lib/moments-db");
const momentRoute = await import("@/app/api/moment/route");
const photoRoute = await import("@/app/api/moment-photo/[id]/route");
const actions = await import("@/app/moment-actions");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const saved = { VERCEL: process.env.VERCEL, BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN, ADMIN_EMAIL: process.env.ADMIN_EMAIL };
const groupIds: string[] = [];
const accountIds: string[] = [];
let counter = 0;
let tag = 0;

type Person = { id: string; name: string };
async function person(label: string): Promise<Person> {
  const a = await db.account.create({ data: { email: `mo-${label}-${++counter}-${stamp}@example.test`, name: label } });
  accountIds.push(a.id);
  return { id: a.id, name: label };
}
const P = {} as Record<"ann" | "bea" | "lou" | "rex" | "cal" | "pam" | "op" | "dee", Person>;
const emailOf = async (p: Person) => (await db.account.findUniqueOrThrow({ where: { id: p.id } })).email;

const as = async (p: Person | null) => {
  state.cookie = p ? await encodeSession({ m: {}, a: p.id, v: 0, t: today() }) : "";
};
const asGuest = async (groupId: string, memberId: string) => {
  state.cookie = await encodeSession({ m: { [groupId]: grantValue(memberId, 0) }, t: today() });
};

// A trip group (10 to 14 March 2026): Ann looks after it, Bea and Dee are in it, Gus is a guest with no email, Lou left 3 days ago, Rex was
// removed 3 days ago, Pam was added by Ann and has never opened it, Cal has nothing to do with it.
async function world(label: string, type = "trip") {
  const n = ++counter;
  const g = await db.group.create({
    data: {
      name: `Moments ${label} ${n} ${stamp}`, inviteCode: `mo-${label}-${n}-${stamp}`, currency: "INR", type, tripStart: "2026-03-10", tripEnd: "2026-03-14",
      members: {
        create: [
          { name: "Ann", accountId: P.ann.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) },
          { name: "Bea", accountId: P.bea.id, claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2) },
          { name: "Dee", accountId: P.dee.id, claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 3) },
          { name: "Gus", claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 4) },
          { name: "Lou", accountId: P.lou.id, claimedAt: new Date(2026, 0, 3), createdAt: new Date(2026, 0, 5), leftAt: ago(3) },
          { name: "Rex", accountId: P.rex.id, claimedAt: new Date(2026, 0, 4), createdAt: new Date(2026, 0, 6), leftAt: ago(3), removedAt: ago(3), removedById: "admin" },
          { name: "Pam", accountId: P.pam.id, createdAt: new Date(2026, 0, 7), addedBy: "Ann" },
        ],
      },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const m = (name: string) => g.members.find((x) => x.name === name)!.id;
  return { id: g.id, ann: m("Ann"), bea: m("Bea"), dee: m("Dee"), gus: m("Gus"), lou: m("Lou"), rex: m("Rex"), pam: m("Pam") };
}
type World = Awaited<ReturnType<typeof world>>;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const getPhoto = (id: string, s: "t" | "f" = "f", headers: Record<string, string> = {}) =>
  photoRoute.GET(new Request(`http://loopin.test/api/moment-photo/${id}?s=${s}`, { headers }), ctx(id));
const body = async (res: Response) => new Uint8Array(await res.arrayBuffer());
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

type Up = { full?: Uint8Array | null; thumb?: Uint8Array | null; caption?: string; takenOn?: string; rid?: string; group: string };
const photos = () => {
  tag += 2;
  return { full: jpeg(1600, 1200, tag), thumb: jpeg(480, 360, tag + 1) };
};
async function upload(o: Up) {
  const p = photos();
  const f = new FormData();
  f.set("group", o.group);
  const full = o.full === undefined ? p.full : o.full;
  const thumb = o.thumb === undefined ? p.thumb : o.thumb;
  if (full) f.set("full", new Blob([full as BlobPart], { type: "image/jpeg" }), "moment.jpg");
  if (thumb) f.set("thumb", new Blob([thumb as BlobPart], { type: "image/jpeg" }), "small.jpg");
  f.set("caption", o.caption ?? "The boat we almost missed 😂");
  f.set("takenOn", o.takenOn ?? "2026-03-12");
  if (o.rid) f.set("rid", o.rid);
  const res = await momentRoute.POST(new Request("http://loopin.test/api/moment", { method: "POST", body: f }));
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string };
  return { res, status: res.status, json, p: { full, thumb } };
}
async function added(w: World, who: Person = P.ann) {
  await as(who);
  const r = await upload({ group: w.id });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return { id: r.json.id!, ...r.p };
}

// A moment put straight in the database and the shelf (so its date can be chosen).
async function seed(w: World, by: Person, memberId: string, createdAt: Date, caption = "seeded") {
  const p = photos();
  const f = await storePhoto("moment", p.full, "image/jpeg", { dbFallback: false });
  const t = await storePhoto("moment", p.thumb, "image/jpeg", { dbFallback: false });
  const row = await db.moment.create({ data: { groupId: w.id, authorId: memberId, authorAccountId: by.id, caption, takenOn: "", type: "image/jpeg", width: 1600, height: 1200, blobKey: f.blobKey, thumbKey: t.blobKey, data: f.data, thumbData: t.data, createdAt } });
  return { id: row.id, full: p.full, thumb: p.thumb };
}

async function leftovers() {
  const everKey = [...new Set(blob.putKeys)];
  const keys = [...blob.files.keys()];
  const rows = everKey.length ? await db.moment.findMany({ where: { OR: [{ blobKey: { in: everKey } }, { thumbKey: { in: everKey } }] }, select: { blobKey: true, thumbKey: true } }) : [];
  const rowKeys = rows.flatMap((r) => [r.blobKey, r.thumbKey]).filter(Boolean);
  return {
    orphanFiles: keys.filter((k) => !rowKeys.includes(k)),
    orphanRows: rowKeys.filter((k) => !blob.files.has(k)),
    stillToDelete: await db.blobTrash.count({ where: { key: { in: everKey } } }),
  };
}
const CLEAN = { orphanFiles: [], orphanRows: [], stillToDelete: 0 };

async function run(fn: (f: FormData) => Promise<unknown>, fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  try {
    await fn(f);
  } catch (err) {
    const m = /^NEXT_REDIRECT (.*)$/.exec(String((err as Error).message));
    if (!m) throw err;
    return m[1];
  }
  return "";
}

beforeAll(async () => {
  process.env.VERCEL = "1";
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
  for (const n of ["ann", "bea", "lou", "rex", "cal", "pam", "op", "dee"] as const) P[n] = await person(n);
  process.env.ADMIN_EMAIL = await emailOf(P.op);
});
beforeEach(async () => {
  // The hourly upload allowance is per person, and one test file adds many moments by the same few people.
  await db.rateLimit.deleteMany({ where: { key: { in: accountIds.map((id) => `moment:${id}`) } } });
  blob.files.clear();
  blob.putKeys.length = 0;
  blob.access.length = 0;
  blob.puts = 0;
  blob.failAt = 0;
  blob.gets = 0;
  blob.dels = 0;
  blob.putDown = false;
  blob.delDown = false;
  blob.onPut = null;
  state.cookie = "";
  state.origin = "http://loopin.test";
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterAll(async () => {
  vi.restoreAllMocks();
  state.cookie = "";
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const ids = (await db.moment.findMany({ where: { groupId: { in: groupIds } }, select: { id: true } })).map((m) => m.id);
  await db.momentReaction.deleteMany({ where: { momentId: { in: ids } } });
  await db.moment.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.blobTrash.deleteMany({ where: { key: { in: [...new Set(blob.putKeys)] } } });
  await db.report.deleteMany({ where: { reporterId: { in: accountIds } } });
  await db.block.deleteMany({ where: { OR: [{ blockerId: { in: accountIds } }, { blockedId: { in: accountIds } }] } });
  await db.requestKey.deleteMany({ where: { key: { contains: stamp } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

// ---------------------------------------------------------------------------------------------------------------
describe("adding a moment and opening its photo", () => {
  it("makes two private files, keeps no photo bytes in the database, and a member opens both (kept only as ask-first, with a tag)", async () => {
    const w = await world("flow");
    const m = await added(w);
    const row = await db.moment.findUniqueOrThrow({ where: { id: m.id } });
    expect(row).toMatchObject({ groupId: w.id, authorId: w.ann, authorAccountId: P.ann.id, caption: "The boat we almost missed 😂", takenOn: "2026-03-12", width: 1600, height: 1200 });
    expect(row.blobKey).toMatch(/^moment\//);
    expect(row.thumbKey).toMatch(/^moment\//);
    expect(row.blobKey).not.toBe(row.thumbKey);
    expect(row.data.length).toBe(0);
    expect(row.thumbData.length).toBe(0);
    expect(blob.files.size).toBe(2);
    expect(blob.access).toEqual(["private", "private"]);
    expect(same(blob.files.get(row.blobKey)!.bytes, m.full!)).toBe(true);
    expect(same(blob.files.get(row.thumbKey)!.bytes, m.thumb!)).toBe(true);

    await as(P.bea);
    const full = await getPhoto(m.id);
    expect(full.status).toBe(200);
    expect(full.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(full.headers.get("ETag")).toBe(`"m-${m.id}-f"`);
    expect(full.headers.get("Vary")).toBe("Cookie");
    expect(full.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(full.headers.get("Content-Type")).toBe("image/jpeg");
    expect(same(await body(full), m.full!)).toBe(true);
    const small = await getPhoto(m.id, "t");
    expect(small.status).toBe(200);
    expect(same(await body(small), m.thumb!)).toBe(true);
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("a matching If-None-Match gives 304 to an allowed viewer without reading storage; a different tag gives the photo", async () => {
    const w = await world("etag");
    const m = await added(w);
    await as(P.bea);
    for (const s of ["f", "t"] as const) {
      const before = blob.gets;
      const tag = `"m-${m.id}-${s}"`;
      const same304 = await getPhoto(m.id, s, { "If-None-Match": tag });
      expect(same304.status, s).toBe(304);
      expect(same304.headers.get("ETag")).toBe(tag);
      expect(same304.headers.get("Cache-Control")).toBe("private, no-cache");
      expect(same304.headers.get("Vary")).toBe("Cookie");
      expect(blob.gets, "a 304 reads nothing").toBe(before);
      expect((await getPhoto(m.id, s, { "If-None-Match": `W/${tag}, "other"` })).status).toBe(304);
      // The tag of the other size is not this one's.
      const other = `"m-${m.id}-${s === "f" ? "t" : "f"}"`;
      expect((await getPhoto(m.id, s, { "If-None-Match": other })).status).toBe(200);
    }
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("a viewer who is removed after caching gets 404, not 304, on the next check", async () => {
    const w = await world("etag-removed");
    const m = await added(w);
    await as(P.dee);
    const ok = await getPhoto(m.id);
    const tag = ok.headers.get("ETag")!;
    expect((await getPhoto(m.id, "f", { "If-None-Match": tag })).status).toBe(304);
    await db.member.update({ where: { id: w.dee }, data: { leftAt: new Date(), removedAt: new Date(), removedById: w.ann } });
    const gone = await getPhoto(m.id, "f", { "If-None-Match": tag });
    expect(gone.status).toBe(404);
    expect(gone.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("a guest member (a name with no email) can open the photo, and cannot add one", async () => {
    const w = await world("guest");
    const m = await added(w);
    await asGuest(w.id, w.gus);
    expect((await getPhoto(m.id)).status).toBe(200);
    const r = await upload({ group: w.id });
    expect(r.status).toBe(401);
    expect(await db.moment.count({ where: { groupId: w.id } })).toBe(1);
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("with file storage off (local, tests) the photos are kept in the row and still served", async () => {
    delete process.env.VERCEL;
    try {
      const w = await world("db");
      const m = await added(w);
      const row = await db.moment.findUniqueOrThrow({ where: { id: m.id } });
      expect(row.blobKey).toBe("");
      expect(same(row.data, m.full!)).toBe(true);
      expect(same(row.thumbData, m.thumb!)).toBe(true);
      await as(P.bea);
      expect(same(await body(await getPhoto(m.id)), m.full!)).toBe(true);
      expect(same(await body(await getPhoto(m.id, "t")), m.thumb!)).toBe(true);
      expect(blob.files.size).toBe(0);
    } finally {
      process.env.VERCEL = "1";
    }
  });

  it("works for a WebP photo, and for a closed group", async () => {
    const w = await world("webp");
    await db.group.update({ where: { id: w.id }, data: { closed: true, closedAt: new Date() } });
    await as(P.ann);
    const r = await upload({ group: w.id, full: webpLossy(1200, 900), thumb: webpLossy(400, 300) });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect((await getPhoto(r.json.id!)).headers.get("Content-Type")).toBe("image/webp");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("who can open a moment's photo: every refusal is the same 404, and storage is not asked", () => {
  async function refused(id: string, who: Person | null, label: string) {
    await as(who);
    const before = blob.gets;
    for (const s of ["f", "t"] as const) {
      const res = await getPhoto(id, s);
      expect(res.status, `${label} ${s}`).toBe(404);
      expect(res.headers.get("Cache-Control"), label).toBe("private, no-store");
      expect(await res.text()).toBe("Not found");
      // A matching tag is no way in: still the same 404 (never a 304), and storage is still not asked.
      const tagged = await getPhoto(id, s, { "If-None-Match": `"m-${id}-${s}"` });
      expect(tagged.status, `${label} ${s} with a tag`).toBe(404);
      expect(tagged.headers.get("Cache-Control"), `${label} with a tag`).toBe("private, no-store");
      expect(tagged.headers.get("ETag"), `${label} with a tag`).toBeNull();
    }
    expect(blob.gets, `${label}: storage was asked`).toBe(before);
  }

  it("signed in but not in the group, signed out, never opened the group, removed by the admin", async () => {
    const w = await world("refused");
    const m = await added(w);
    await refused(m.id, P.cal, "outsider");
    await refused(m.id, null, "signed out");
    await refused(m.id, P.pam, "pending");
    await refused(m.id, P.rex, "removed");
    await refused("not-a-real-moment-id", P.ann, "no such moment");
    await refused("../../etc/passwd", P.ann, "rubbish id");
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("someone who is in another group can't use this group's moment either", async () => {
    const w = await world("mix-a");
    const other = await world("mix-b");
    const m = await added(w);
    // Cal is in group B only.
    await db.member.create({ data: { name: "Cal", accountId: P.cal.id, claimedAt: new Date(), groupId: other.id } });
    await refused(m.id, P.cal, "member of another group");
  });

  it("a block between the viewer and the author, either way", async () => {
    const w = await world("blocked");
    const m = await added(w, P.ann);
    await db.block.create({ data: { blockerId: P.bea.id, blockedId: P.ann.id } }); // Bea blocked Ann
    await refused(m.id, P.bea, "viewer blocked the author");
    await db.block.deleteMany({ where: { blockerId: P.bea.id } });
    await db.block.create({ data: { blockerId: P.ann.id, blockedId: P.dee.id } }); // Ann blocked Dee
    await refused(m.id, P.dee, "author blocked the viewer");
    await as(P.bea);
    expect((await getPhoto(m.id)).status, "after the block is lifted").toBe(200);
    await db.block.deleteMany({ where: { blockerId: P.ann.id } });
  });

  it("someone who left sees moments from before they left (200) and not ones added after (404)", async () => {
    const w = await world("leaver");
    const before = await seed(w, P.ann, w.ann, ago(5)); // Lou left 3 days ago
    const after = await added(w, P.ann); // now
    await as(P.lou);
    const ok = await getPhoto(before.id);
    expect(ok.status).toBe(200);
    expect(same(await body(ok), before.full)).toBe(true);
    await refused(after.id, P.lou, "added after they left");
  });

  it("the operator is shut out of a deleted group's photo even with a report open", async () => {
    const w = await world("operator-deleted");
    const m = await added(w, P.ann);
    await db.report.create({ data: { reporterId: P.bea.id, kind: "moment", targetId: m.id, targetAccountId: P.ann.id, reason: "other" } });
    await as(P.op);
    expect((await getPhoto(m.id)).status, "group alive").toBe(200);
    await db.group.update({ where: { id: w.id }, data: { deletedAt: new Date() } });
    await refused(m.id, P.op, "operator, group deleted");
    await db.group.update({ where: { id: w.id }, data: { deletedAt: null } });
    await as(P.op);
    expect((await getPhoto(m.id)).status, "group restored").toBe(200);
  });

  it("the loopin operator sees a photo only while a report about it is open", async () => {
    const w = await world("operator");
    const m = await added(w, P.ann);
    await refused(m.id, P.op, "operator, no report");
    const report = await db.report.create({ data: { reporterId: P.bea.id, kind: "moment", targetId: m.id, targetAccountId: P.ann.id, reason: "other" } });
    await as(P.op);
    const open = await getPhoto(m.id);
    expect(open.status).toBe(200);
    expect(open.headers.get("Cache-Control")).toBe("private, no-store");
    // A report about something else, or a different kind, opens nothing.
    const w2 = await world("operator-2");
    const m2 = await added(w2, P.ann);
    await db.report.create({ data: { reporterId: P.bea.id, kind: "person", targetId: m2.id, targetAccountId: P.ann.id, reason: "other" } });
    await refused(m2.id, P.op, "operator, a report of another kind");
    await db.report.update({ where: { id: report.id }, data: { status: "resolved", resolvedAt: new Date() } });
    await refused(m.id, P.op, "operator, report resolved");
    await db.report.create({ data: { reporterId: P.dee.id, kind: "moment", targetId: m.id, targetAccountId: P.ann.id, reason: "spam" } });
    await refused(m.id, P.cal, "an ordinary outsider, even with a report open");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("who can add, and what the upload checks", () => {
  it("non-members, signed-out visitors, people who left, were removed or never opened the group get nothing stored", async () => {
    const w = await world("add-refused");
    for (const [who, expected] of [[P.cal, 404], [null, 401], [P.lou, 404], [P.rex, 404], [P.pam, 404]] as const) {
      await as(who);
      const r = await upload({ group: w.id });
      expect(r.status, who?.name ?? "signed out").toBe(expected);
    }
    expect(blob.files.size).toBe(0);
    expect(blob.puts).toBe(0);
    expect(await db.moment.count({ where: { groupId: w.id } })).toBe(0);
  });

  it("a group that isn't a trip, or that was deleted, takes none", async () => {
    const home = await world("add-home", "home");
    const gone = await world("add-deleted");
    await db.group.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    await as(P.ann);
    expect((await upload({ group: home.id })).status).toBe(404);
    expect((await upload({ group: gone.id })).status).toBe(404);
    expect((await upload({ group: "nope" })).status).toBe(404);
    expect(blob.puts).toBe(0);
  });

  it("a request from another site is refused", async () => {
    const w = await world("add-origin");
    await as(P.ann);
    state.origin = "https://evil.example";
    const r = await upload({ group: w.id });
    expect(r.status).toBe(403);
    expect(blob.puts).toBe(0);
    expect(await db.moment.count({ where: { groupId: w.id } })).toBe(0);
  });

  it("refuses a photo that is too big in pixels, not a JPEG/WebP, cut off, or missing, with nothing stored", async () => {
    const w = await world("add-bad");
    await as(P.ann);
    const good = photos();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 1, 0, 0, 0, 1, 0, 8, 6, 0, 0, 0]);
    const cases: [string, Up, number][] = [
      ["1601 px full photo", { group: w.id, full: jpeg(1601, 900, 5) }, 415],
      ["481 px small copy", { group: w.id, thumb: jpeg(481, 300, 6) }, 415],
      ["a PNG", { group: w.id, full: png }, 415],
      ["words instead of a photo", { group: w.id, full: new TextEncoder().encode("hello, not a photo at all") }, 415],
      ["a JPEG that can't be checked for hidden details", { group: w.id, full: good.full.subarray(0, good.full.length - 2) }, 415],
      ["no full photo", { group: w.id, full: null }, 400],
      ["no small copy", { group: w.id, thumb: null }, 400],
      ["over 1 MB", { group: w.id, full: (() => { const b = new Uint8Array(1_000_001); b.set(jpeg(1000, 1000, 9)); return b; })() }, 413],
      ["a small copy over 120 KB", { group: w.id, thumb: (() => { const b = new Uint8Array(120_001); b.set(jpeg(400, 300, 9)); return b; })() }, 413],
    ];
    for (const [label, o, status] of cases) expect((await upload(o)).status, label).toBe(status);
    expect(blob.puts).toBe(0);
    expect(await db.moment.count({ where: { groupId: w.id } })).toBe(0);
  });

  it("refuses an animated WebP (flag or frames) with the usual message and nothing stored; a still extended WebP is fine", async () => {
    const w = await world("add-animated");
    await as(P.ann);
    for (const [label, anim] of [["flag and frames", webpAnimated(1200, 900)], ["flag only", webpAnimatedFlagOnly(1200, 900)]] as const) {
      const r = await upload({ group: w.id, full: anim });
      expect(r.status, label).toBe(415);
      expect(r.json.error, label).toBe("Pick a photo (JPEG or WebP) that Loopin can read.");
      const t = await upload({ group: w.id, thumb: anim });
      expect(t.status, `${label} (small copy)`).toBe(415);
    }
    expect(blob.puts).toBe(0);
    expect(await db.moment.count({ where: { groupId: w.id } })).toBe(0);
    // Not animated (alpha flag only): passes this check (it may still be refused later if it can't be checked, but never for this reason).
    const still = await upload({ group: w.id, full: webpExtended(1200, 900), thumb: webpExtended(400, 300) });
    expect(still.json.error ?? "").not.toBe("Pick a photo (JPEG or WebP) that Loopin can read.");
  });

  it("the stored photo has no location: an Exif GPS block in the upload is gone from both copies", async () => {
    const w = await world("add-gps");
    await as(P.ann);
    const full = jpegWithGps(1600, 1200, 21);
    const thumb = jpegWithGps(480, 360, 23);
    const has = (b: Uint8Array, text: string) => Buffer.from(b).includes(Buffer.from(text, "latin1"));
    expect(has(full, GPS_MARKER) && has(full, "Exif"), "the fixture really carries a location").toBe(true);
    const r = await upload({ group: w.id, full, thumb });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const row = await db.moment.findUniqueOrThrow({ where: { id: r.json.id! } });
    for (const key of [row.blobKey, row.thumbKey]) {
      const stored = blob.files.get(key)!.bytes;
      expect(has(stored, GPS_MARKER), "location text still there").toBe(false);
      expect(has(stored, "Exif"), "Exif block still there").toBe(false);
      expect([stored[0], stored[1]]).toEqual([0xff, 0xd8]); // still a JPEG
    }
    await as(P.bea);
    const served = await body(await getPhoto(r.json.id!));
    expect(has(served, GPS_MARKER)).toBe(false);
  });

  it("checks the words and the day: 81 characters, or a day outside the trip, is refused; line breaks become spaces", async () => {
    const w = await world("add-words");
    await as(P.ann);
    expect((await upload({ group: w.id, caption: "a".repeat(81) })).status).toBe(400);
    expect((await upload({ group: w.id, caption: " ".repeat(2001) })).status, "2,001 code units").toBe(400);
    expect((await upload({ group: w.id, caption: `a${"\u0301".repeat(5000)}` })).status, "5,000 combining marks").toBe(400);
    expect((await upload({ group: w.id, takenOn: "2026-03-15" })).status).toBe(400);
    expect((await upload({ group: w.id, takenOn: "2026-03-09" })).status).toBe(400);
    expect(blob.puts).toBe(0);
    const ok = await upload({ group: w.id, caption: "  one\ntwo\u202e\u200b three ", takenOn: "" });
    expect(ok.status).toBe(200);
    expect(await db.moment.findUniqueOrThrow({ where: { id: ok.json.id! } })).toMatchObject({ caption: "one two three", takenOn: "" });
  });

  it("the same form sent twice makes one moment and leaves no extra files", async () => {
    const w = await world("add-twice");
    await as(P.ann);
    const rid = `mo-rid-${stamp}-${w.id}`.slice(0, 60);
    const a = await upload({ group: w.id, rid });
    const b = await upload({ group: w.id, rid });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.json.id).toBe(a.json.id);
    expect(await db.moment.count({ where: { groupId: w.id } })).toBe(1);
    expect(blob.files.size).toBe(2);
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("the 11th moment by one person in 24 hours is refused (10 are fine), and so is the 301st in a group", async () => {
    const w = await world("limits");
    for (let i = 0; i < 10; i++) await db.moment.create({ data: { groupId: w.id, authorId: w.ann, authorAccountId: P.ann.id, data: new Uint8Array(), thumbData: new Uint8Array(), createdAt: new Date(Date.now() - i * 60_000) } });
    await as(P.ann);
    const eleventh = await upload({ group: w.id });
    expect(eleventh.status).toBe(429);
    expect(blob.puts).toBe(0);
    // Bea hasn't added any, so she can; and Ann's older ones (over a day ago) don't count.
    await as(P.bea);
    expect((await upload({ group: w.id })).status).toBe(200);
    await db.moment.updateMany({ where: { groupId: w.id, authorAccountId: P.ann.id }, data: { createdAt: ago(2) } });
    await as(P.ann);
    expect((await upload({ group: w.id })).status).toBe(200);

    const full = await world("limits-group");
    await db.moment.createMany({ data: Array.from({ length: 300 }, (_, i) => ({ groupId: full.id, authorId: full.bea, authorAccountId: P.bea.id, data: new Uint8Array(), thumbData: new Uint8Array(), createdAt: ago(2 + i / 1000) })) });
    await as(P.ann);
    const r = await upload({ group: full.id });
    expect(r.status).toBe(409);
    expect(r.json.error).toContain("Delete an old one to add more");
    expect(await db.moment.count({ where: { groupId: full.id } })).toBe(300);
  });
});

describe("when file storage misbehaves: no row and no orphan file", () => {
  it("the first upload fails", async () => {
    const w = await world("fail-1");
    await as(P.ann);
    blob.failAt = 1;
    const r = await upload({ group: w.id });
    expect(r.status).toBe(502);
    expect(r.json.error).toBe("Couldn’t save that photo. Please try again.");
    expect(await db.moment.count({ where: { groupId: w.id } })).toBe(0);
    expect(blob.files.size).toBe(0);
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("the second upload fails: the first file is deleted", async () => {
    const w = await world("fail-2");
    await as(P.ann);
    blob.failAt = 2;
    const r = await upload({ group: w.id });
    expect(r.status).toBe(502);
    expect(await db.moment.count({ where: { groupId: w.id } })).toBe(0);
    expect(blob.putKeys).toHaveLength(1);
    expect(blob.files.size).toBe(0);
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("with storage down, nothing is kept in the database instead", async () => {
    const w = await world("fail-down");
    await as(P.ann);
    blob.putDown = true;
    expect((await upload({ group: w.id })).status).toBe(502);
    expect(await db.moment.count({ where: { groupId: w.id } })).toBe(0);
  });

  it("the person is removed between the upload and the save: no row, and both files are deleted", async () => {
    const w = await world("fail-removed");
    await as(P.ann);
    // Ann (who looks after the group) is taken out of it just after the first file lands. Bea adds it instead.
    await as(P.bea);
    blob.onPut = async () => {
      blob.onPut = null;
      await db.member.update({ where: { id: w.bea }, data: { leftAt: new Date(), removedAt: new Date(), removedById: w.ann } });
    };
    const r = await upload({ group: w.id });
    expect(r.status).toBe(404);
    expect(await db.moment.count({ where: { groupId: w.id } })).toBe(0);
    expect(blob.putKeys).toHaveLength(2);
    expect(blob.files.size).toBe(0);
    expect(await leftovers()).toEqual(CLEAN);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("deleting and removing: both files go, with the row", () => {
  it("the author deletes their own", async () => {
    const w = await world("del-author");
    const m = await added(w, P.bea);
    expect(blob.files.size).toBe(2);
    const went = await run(actions.deleteMomentAction, { momentId: m.id });
    expect(went).toBe(`/groups/${w.id}/moments?removed=1`);
    expect(await db.moment.count({ where: { id: m.id } })).toBe(0);
    expect(blob.files.size).toBe(0);
    expect(await leftovers()).toEqual(CLEAN);
    expect((await getPhoto(m.id)).status).toBe(404);
  });

  it("whoever looks after the group removes someone else's; an ordinary member can't", async () => {
    const w = await world("del-admin");
    const m = await added(w, P.bea);
    await as(P.dee);
    expect(await run(actions.deleteMomentAction, { momentId: m.id })).toBe("/");
    expect(await db.moment.count({ where: { id: m.id } })).toBe(1);
    expect(blob.files.size).toBe(2);
    await as(P.ann);
    expect(await run(actions.deleteMomentAction, { momentId: m.id })).toBe(`/groups/${w.id}/moments?removed=1`);
    expect(await db.moment.count({ where: { id: m.id } })).toBe(0);
    expect(blob.files.size).toBe(0);
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("outsiders, signed-out visitors, and people removed from the group delete nothing", async () => {
    const w = await world("del-refused");
    const m = await added(w, P.bea);
    for (const who of [P.cal, null, P.rex, P.pam]) {
      await as(who);
      expect(await run(actions.deleteMomentAction, { momentId: m.id }), who?.name ?? "signed out").toBe("/");
    }
    expect(await db.moment.count({ where: { id: m.id } })).toBe(1);
    expect(blob.files.size).toBe(2);
  });

  it("the author can still delete one after leaving", async () => {
    const w = await world("del-after-leaving");
    const m = await added(w, P.bea);
    await db.member.update({ where: { id: w.bea }, data: { leftAt: new Date(Date.now() + 1000) } });
    await as(P.bea);
    expect(await run(actions.deleteMomentAction, { momentId: m.id })).toBe(`/groups/${w.id}/moments?removed=1`);
    expect(blob.files.size).toBe(0);
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("the operator removes a reported moment (and only that, and only while the report is open)", async () => {
    const w = await world("del-operator");
    const m = await added(w, P.bea);
    const other = await added(w, P.dee);
    await as(P.op);
    // No open report: nothing happens.
    expect(await run(actions.removeReportedMomentAction, { momentId: m.id })).toBe("/stats/reports");
    expect(await db.moment.count({ where: { id: m.id } })).toBe(1);
    const report = await db.report.create({ data: { reporterId: P.dee.id, kind: "moment", targetId: m.id, targetAccountId: P.bea.id, reason: "abusive" } });
    // Someone who isn't the operator can't.
    await as(P.ann);
    expect(await run(actions.removeReportedMomentAction, { momentId: m.id })).toBe("/");
    expect(await db.moment.count({ where: { id: m.id } })).toBe(1);
    await as(P.op);
    expect(await run(actions.removeReportedMomentAction, { momentId: m.id })).toBe("/stats/reports");
    expect(await db.moment.count({ where: { id: m.id } })).toBe(0);
    expect(await db.moment.count({ where: { id: other.id } })).toBe(1);
    expect((await db.report.findUniqueOrThrow({ where: { id: report.id } })).status).toBe("resolved");
    expect(blob.files.size).toBe(2); // the other moment's two files
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("the author deleting their own reported moment leaves the report open; the operator's remove of it afterwards still closes it", async () => {
    const w = await world("del-author-reported");
    const m = await added(w, P.bea);
    const report = await db.report.create({ data: { reporterId: P.dee.id, kind: "moment", targetId: m.id, targetAccountId: P.bea.id, reason: "abusive" } });
    await as(P.bea);
    expect(await run(actions.deleteMomentAction, { momentId: m.id })).toBe(`/groups/${w.id}/moments?removed=1`);
    expect(await db.moment.count({ where: { id: m.id } })).toBe(0);
    expect(await db.report.findUniqueOrThrow({ where: { id: report.id } })).toMatchObject({ status: "open", resolvedAt: null });
    // The moment is already gone; the operator's "Remove the moment" must still close the report.
    await as(P.op);
    expect(await run(actions.removeReportedMomentAction, { momentId: m.id })).toBe("/stats/reports");
    const after = await db.report.findUniqueOrThrow({ where: { id: report.id } });
    expect(after.status).toBe("resolved");
    expect(after.resolvedAt).not.toBeNull();
  });
});

describe("account deletion and the 30-day purge", () => {
  it("deleting an account deletes the moments that person added, with their photos, and keeps everyone else's", async () => {
    const leaving = await person("leaving");
    const w = await world("account");
    await db.member.create({ data: { name: "Leaving", accountId: leaving.id, claimedAt: new Date(), createdAt: new Date(2026, 0, 8), groupId: w.id } });
    const mineA = await added(w, leaving);
    const mineB = await added(w, leaving);
    const theirs = await added(w, P.bea);
    await db.momentReaction.create({ data: { momentId: mineA.id, memberId: w.bea, emoji: "😂" } });
    expect(blob.files.size).toBe(6);
    await deleteAccount(leaving.id);
    expect(await db.moment.count({ where: { id: { in: [mineA.id, mineB.id] } } })).toBe(0);
    expect(await db.momentReaction.count({ where: { momentId: mineA.id } })).toBe(0);
    expect(await db.moment.count({ where: { id: theirs.id } })).toBe(1);
    expect(blob.files.size).toBe(2);
    expect(await leftovers()).toEqual(CLEAN);
    accountIds.splice(accountIds.indexOf(leaving.id), 1);
  });

  it("a group deleted more than 30 days ago is erased with its moments and files; one deleted 29 days ago is left alone", async () => {
    const oldG = await world("purge-old");
    const recent = await world("purge-recent");
    await added(oldG, P.ann);
    await added(oldG, P.bea);
    const keep = await added(recent, P.ann);
    await db.momentReaction.create({ data: { momentId: keep.id, memberId: recent.bea, emoji: "🔥" } });
    await db.group.update({ where: { id: oldG.id }, data: { deletedAt: ago(31) } });
    await db.group.update({ where: { id: recent.id }, data: { deletedAt: ago(29) } });
    expect(blob.files.size).toBe(6);
    await eraseExpiredGroups(new Date(), 1000);
    expect(await db.moment.count({ where: { groupId: oldG.id } })).toBe(0);
    expect(await db.moment.count({ where: { groupId: recent.id } })).toBe(1);
    expect(await db.momentReaction.count({ where: { momentId: keep.id } })).toBe(1);
    expect(blob.files.size).toBe(2);
    expect(await leftovers()).toEqual(CLEAN);
  });

  it("nobody can see a deleted group's moments before it is erased", async () => {
    const w = await world("deleted-group");
    const m = await added(w, P.ann);
    await db.group.update({ where: { id: w.id }, data: { deletedAt: new Date() } });
    await as(P.bea);
    expect((await getPhoto(m.id)).status).toBe(404);
    await as(P.ann);
    expect((await getPhoto(m.id)).status).toBe(404);
    await db.group.update({ where: { id: w.id }, data: { deletedAt: null } }); // Restore
    expect((await getPhoto(m.id)).status).toBe(200);
  });

  it("a file a moment still points to is never deleted by the to-delete list", async () => {
    const w = await world("trash-guard");
    const m = await added(w, P.ann);
    const row = await db.moment.findUniqueOrThrow({ where: { id: m.id } });
    await db.blobTrash.createMany({ data: [{ key: row.blobKey }, { key: row.thumbKey }] });
    const r = await flushPhotoDeletes(50, new Date(Date.now() + 3 * HOUR));
    expect(r.kept).toBe(2);
    expect(blob.files.size).toBe(2);
    expect(await leftovers()).toEqual(CLEAN);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the lists, the strip and reactions use the same rules", () => {
  it("hides blocked people's moments, cuts a leaver at the day they left, and shows nothing to a removed person", async () => {
    const w = await world("lists");
    const early = await seed(w, P.ann, w.ann, ago(5), "early");
    const late = await added(w, P.bea);
    await as(P.dee);
    expect((await listMoments(await loadMomentViewer(w.id))).map((c) => c.id).sort()).toEqual([early.id, late.id].sort());
    expect((await momentStrip(await loadMomentViewer(w.id))).count).toBe(2);

    await db.block.create({ data: { blockerId: P.dee.id, blockedId: P.bea.id } });
    expect((await listMoments(await loadMomentViewer(w.id))).map((c) => c.id)).toEqual([early.id]);
    expect(await loadMomentCard(await loadMomentViewer(w.id), late.id)).toBeNull();
    expect((await momentStrip(await loadMomentViewer(w.id))).count).toBe(1);
    await db.block.deleteMany({ where: { blockerId: P.dee.id } });

    await as(P.lou); // left 3 days ago
    expect((await listMoments(await loadMomentViewer(w.id))).map((c) => c.id)).toEqual([early.id]);
    await as(P.rex);
    expect(await listMoments(await loadMomentViewer(w.id))).toEqual([]);
    expect((await momentStrip(await loadMomentViewer(w.id))).count).toBe(0);
    await as(P.cal);
    expect(await loadMomentViewer(w.id)).toBeNull();
  });

  it("a person is never shown the author's account in a way that lets them see more: canSeeMoment on every returned row", async () => {
    const w = await world("lists-check");
    await added(w, P.ann);
    await as(P.bea);
    const viewer = await loadMomentViewer(w.id);
    const cards = await listMoments(viewer);
    expect(cards).toHaveLength(1);
    for (const c of cards) expect(canSeeMoment(viewer, c)).toBe(true);
  });

  it("the reaction action refuses a viewer with a block either way, and changes nothing", async () => {
    const w = await world("react-blocked");
    const m = await added(w, P.ann);
    await db.block.create({ data: { blockerId: P.bea.id, blockedId: P.ann.id } }); // Bea blocked the author
    await db.block.create({ data: { blockerId: P.ann.id, blockedId: P.dee.id } }); // the author blocked Dee
    for (const who of [P.bea, P.dee]) {
      await as(who);
      const went = await run(actions.reactMomentAction, { momentId: m.id, emoji: "😂" });
      expect(went, who.name).toContain(`/groups/${w.id}/moments`);
      expect(await db.momentReaction.count({ where: { momentId: m.id } }), `${who.name} left a reaction`).toBe(0);
    }
    await db.block.deleteMany({ where: { OR: [{ blockerId: P.bea.id }, { blockerId: P.ann.id }] } });
    await as(P.bea);
    await run(actions.reactMomentAction, { momentId: m.id, emoji: "😂" });
    expect(await db.momentReaction.count({ where: { momentId: m.id } }), "after the block is lifted").toBe(1);
  });

  it("reacting: one per person, tap again to take it back, blocked people's reactions are not counted, leavers can't react", async () => {
    const w = await world("react");
    const m = await added(w, P.ann);
    await as(P.bea);
    expect(await run(actions.reactMomentAction, { momentId: m.id, emoji: "😂" })).toContain(`/groups/${w.id}/moments`);
    await as(P.dee);
    await run(actions.reactMomentAction, { momentId: m.id, emoji: "😂" });
    expect((await loadMomentCard(await loadMomentViewer(w.id), m.id))!.reactions).toEqual([{ emoji: "😂", count: 2, mine: true }]);
    await run(actions.reactMomentAction, { momentId: m.id, emoji: "🔥" }); // a different one changes hers
    expect((await loadMomentCard(await loadMomentViewer(w.id), m.id))!.reactions).toEqual([
      { emoji: "😂", count: 1, mine: false },
      { emoji: "🔥", count: 1, mine: true },
    ]);
    await run(actions.reactMomentAction, { momentId: m.id, emoji: "🔥" }); // again: taken back
    expect(await db.momentReaction.count({ where: { momentId: m.id, memberId: w.dee } })).toBe(0);
    // Ann blocked Bea: Bea's reaction is left out of Ann's count.
    await db.block.create({ data: { blockerId: P.ann.id, blockedId: P.bea.id } });
    await as(P.ann);
    expect((await loadMomentCard(await loadMomentViewer(w.id), m.id))!.reactions).toEqual([]);
    await db.block.deleteMany({ where: { blockerId: P.ann.id } });
    // A leaver, a stranger and a made-up emoji change nothing.
    for (const who of [P.lou, P.rex, P.cal, null]) {
      await as(who);
      await run(actions.reactMomentAction, { momentId: m.id, emoji: "🎉" });
    }
    await as(P.bea);
    await run(actions.reactMomentAction, { momentId: m.id, emoji: "not an emoji" });
    expect(await db.momentReaction.count({ where: { momentId: m.id } })).toBe(1);
  });

  it("a double tap with the same emoji: the second save hits the one-per-person rule and is treated as already saved (no error page)", async () => {
    const w = await world("dbltap");
    const m = await added(w, P.ann);
    await as(P.bea);
    // Stand in for the other tap winning the race: its row appears, then this save is refused with Prisma's unique-rule error (P2002).
    const real = db.momentReaction.upsert.bind(db.momentReaction);
    const spy = vi.spyOn(db.momentReaction, "upsert").mockImplementationOnce((async (args: Parameters<typeof real>[0]) => {
      await real(args);
      throw Object.assign(new Error("Unique constraint failed on the fields: (`momentId`,`memberId`)"), { code: "P2002" });
    }) as unknown as typeof db.momentReaction.upsert);
    try {
      const went = await run(actions.reactMomentAction, { momentId: m.id, emoji: "😂" });
      expect(went).toContain(`/groups/${w.id}/moments`); // a normal redirect back, not a thrown error
    } finally {
      spy.mockRestore();
    }
    const rows = await db.momentReaction.findMany({ where: { momentId: m.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ memberId: w.bea, emoji: "😂" });
  });

  it("a double tap with two different emojis: the last choice wins (retried once as an update)", async () => {
    const w = await world("dbltap3");
    const m = await added(w, P.ann);
    await as(P.bea);
    // The other tap (🔥) got in first; this one (😂) is refused by the unique rule, then retried as a change to 😂.
    const spy = vi.spyOn(db.momentReaction, "upsert").mockImplementationOnce((async () => {
      await db.momentReaction.create({ data: { momentId: m.id, memberId: w.bea, emoji: "🔥" } });
      throw Object.assign(new Error("Unique constraint failed on the fields: (`momentId`,`memberId`)"), { code: "P2002" });
    }) as unknown as typeof db.momentReaction.upsert);
    try {
      expect(await run(actions.reactMomentAction, { momentId: m.id, emoji: "😂" })).toContain(`/groups/${w.id}/moments`);
    } finally {
      spy.mockRestore();
    }
    const rows = await db.momentReaction.findMany({ where: { momentId: m.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ memberId: w.bea, emoji: "😂" });
  });

  it("any other database error is still raised, not hidden", async () => {
    const w = await world("dbltap2");
    const m = await added(w, P.ann);
    await as(P.bea);
    const spy = vi.spyOn(db.momentReaction, "upsert").mockImplementationOnce((async () => {
      throw Object.assign(new Error("disk is full"), { code: "P1008" });
    }) as unknown as typeof db.momentReaction.upsert);
    try {
      await expect(run(actions.reactMomentAction, { momentId: m.id, emoji: "😂" })).rejects.toThrow("disk is full");
    } finally {
      spy.mockRestore();
    }
  });
});
