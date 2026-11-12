import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The hand-over from the old address needs one tap on the new one: opening the link
// must never sign anyone in (login CSRF), and the pass is used up only by the tap.

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>(), set: [] as string[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.cookies.has(n) ? { value: jar.cookies.get(n)! } : undefined),
    set: (n: string, v: string) => {
      jar.cookies.set(n, v);
      jar.set.push(n);
    },
    delete: (n: string) => jar.cookies.delete(n),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { createMovePass, peekMovePass } = await import("@/lib/move");
const { encodeSession, SESSION_COOKIE } = await import("@/lib/session");
const { GET } = await import("@/app/api/arrive/route");
const { confirmArrival } = await import("@/app/arrive/actions");

const groups: string[] = [];
afterAll(async () => {
  await eraseGroups(groups);
});

async function pass() {
  const g = await db.group.create({
    data: { name: "Arrive", currency: "INR", inviteCode: `arr-${Date.now()}-${Math.random()}`, members: { create: [{ name: "Meera Rao" }] } },
    include: { members: true },
  });
  groups.push(g.id);
  const session = await encodeSession({ m: { [g.id]: g.members[0].id } });
  const t = (await createMovePass(session, true))!;
  return { t, session };
}
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
async function redirectOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    const m = /^NEXT_REDIRECT (.*)$/.exec(String((err as Error)?.message));
    if (!m) throw err;
    return m[1];
  }
  throw new Error("expected a redirect");
}
const passRows = (t: string) => db.requestKey.count({ where: { key: `move:${t}` } });

describe("arriving from the old address", () => {
  it("opening the link (GET) sets no sign-in, does not use up the pass, and leads to the confirm page", async () => {
    const { t } = await pass();
    const res = await GET(new NextRequest(`https://loopinapps.com/api/arrive?t=${t}&to=%2Fsettle`));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe(`/arrive?t=${t}&to=%2Fsettle`);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await passRows(t)).toBe(1);
    // Looking at it (the confirm page) names the person and still doesn't spend it.
    expect(await peekMovePass(t)).toEqual({ firstName: "Meera" });
    expect(await peekMovePass(t)).toEqual({ firstName: "Meera" });
    expect(await passRows(t)).toBe(1);
  });

  it("already signed in, or no pass: the link just opens the page and the pass is left alone", async () => {
    const { t } = await pass();
    const signedIn = await GET(new NextRequest(`https://loopinapps.com/api/arrive?t=${t}&to=%2Fsettle`, { headers: { cookie: `${SESSION_COOKIE}=someone-else` } }));
    expect(new URL(signedIn.headers.get("location")!).pathname).toBe("/settle");
    expect(signedIn.headers.get("set-cookie")).toBeNull();
    expect(await passRows(t)).toBe(1);
    const none = await GET(new NextRequest("https://loopinapps.com/api/arrive?t=nope&to=%2Fsettle"));
    expect(new URL(none.headers.get("location")!).pathname).toBe("/settle");
    // A crafted "to" can't leave the site.
    const evil = await GET(new NextRequest(`https://loopinapps.com/api/arrive?t=${t}&to=%2F%2Fevil.com`));
    expect(new URL(evil.headers.get("location")!).origin).toBe("https://loopinapps.com");
  });

  it("the tap (POST) signs in once and uses the pass; a second tap is refused with a calm page", async () => {
    jar.cookies.clear();
    jar.set.length = 0;
    const { t, session } = await pass();
    const dest = await redirectOf(() => confirmArrival(form({ t, to: "/settle" })));
    expect(dest).toBe("/settle?moved=1");
    expect(jar.cookies.get(SESSION_COOKIE)).toBe(session);
    expect(jar.cookies.get("lp_tour")).toBe("1");
    expect(await passRows(t)).toBe(0);

    jar.cookies.clear();
    jar.set.length = 0;
    const again = await redirectOf(() => confirmArrival(form({ t, to: "/settle" })));
    expect(again).toBe("/arrive?to=%2Fsettle&gone=1");
    expect(jar.set).toEqual([]);
    expect(jar.cookies.has(SESSION_COOKIE)).toBe(false);
    expect(await peekMovePass(t)).toBeNull();
  });

  it("the tap when already signed in changes nothing and leaves the pass unused", async () => {
    jar.cookies.clear();
    jar.set.length = 0;
    jar.cookies.set(SESSION_COOKIE, "someone-else");
    const { t } = await pass();
    expect(await redirectOf(() => confirmArrival(form({ t, to: "/settle" })))).toBe("/settle");
    expect(jar.cookies.get(SESSION_COOKIE)).toBe("someone-else");
    expect(jar.set).toEqual([]);
    expect(await passRows(t)).toBe(1);
    jar.cookies.clear();
  });

  it("an expired pass is refused at the tap, and a made-up one too", async () => {
    jar.cookies.clear();
    const { t } = await pass();
    await db.requestKey.updateMany({ where: { key: `move:${t}` }, data: { createdAt: new Date(Date.now() - 3 * 60_000) } });
    expect(await peekMovePass(t)).toBeNull();
    expect(await redirectOf(() => confirmArrival(form({ t, to: "/" })))).toBe("/arrive?to=%2F&gone=1");
    expect(await redirectOf(() => confirmArrival(form({ t: "made-up", to: "/" })))).toBe("/arrive?to=%2F&gone=1");
    expect(jar.cookies.has(SESSION_COOKIE)).toBe(false);
  });
});
