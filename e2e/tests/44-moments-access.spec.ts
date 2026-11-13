import { request as pwRequest } from "@playwright/test";
import { test, expect } from "../fixtures";
import { baseURL, bypassHeaders, testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { contextFor, createGroup, joinGroup, settled } from "../helpers/app";

// Moments: only people in the trip group see its photos. Two members, someone who left, an outsider and a signed-out visitor
// all ask for the same photo address; each gets what the access table says (the rules are in src/lib/moments-access.ts).
//
// Moments are put straight into the database here (the upload itself is covered by tests/moments-storage-e2e.test.ts), so what
// this test follows is who can open them in a real browser.
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

test("a member sees a moment; someone who left sees only the older ones; strangers and signed-out visitors get 404", async ({ browser }) => {
  test.setTimeout(180_000);
  const asha = await signUp("Asha", testEmail("mo-asha"));
  const ravi = await signUp("Ravi", testEmail("mo-ravi"));
  const meera = await signUp("Meera", testEmail("mo-meera"));
  const nina = await signUp("Nina", testEmail("mo-nina"));
  const A = await (await contextFor(browser, asha)).newPage();
  const R = await (await contextFor(browser, ravi)).newPage();
  const M = await (await contextFor(browser, meera)).newPage();
  const N = await (await contextFor(browser, nina)).newPage();
  const g = await createGroup(A, groupName("Moments"), "Trip");
  await joinGroup(R, g.invite, g.path);
  await joinGroup(M, g.invite, g.path);
  const gid = g.path.split("/").pop()!;

  const { db } = await import("../helpers/db");
  try {
    const memberId = async (name: string) => (await db.member.findFirstOrThrow({ where: { groupId: gid, name } })).id;
    const accountId = async (email: string) => (await db.account.findFirstOrThrow({ where: { email } })).id;
    const [ashaMember, ashaAccount] = [await memberId("Asha"), await accountId(asha.email)];
    const day = 86_400_000;
    const add = (caption: string, createdAt: Date) =>
      db.moment.create({ data: { groupId: gid, authorId: ashaMember, authorAccountId: ashaAccount, caption, type: "image/jpeg", width: 1, height: 1, data: TINY_JPEG, thumbData: TINY_JPEG, createdAt } });
    const older = await add("The older one", new Date(Date.now() - 2 * day));
    const newer = await add("The newer one", new Date());
    // Meera left yesterday: she was in the group when "The older one" was added, not when "The newer one" was.
    await db.member.update({ where: { id: await memberId("Meera") }, data: { leftAt: new Date(Date.now() - day) } });

    const photo = (id: string, size: "t" | "f" = "f") => `${baseURL}/api/moment-photo/${id}?s=${size}`;
    const A200 = await A.request.get(photo(newer.id), { headers: bypassHeaders });
    expect(A200.status()).toBe(200);
    expect(A200.headers()["content-type"]).toBe("image/jpeg");
    expect(A200.headers()["cache-control"]).toBe("private, no-cache");
    expect(A200.headers()["etag"]).toBe(`"m-${newer.id}-f"`);
    // A matching tag: "not changed" for someone who may see it, and the same plain 404 for someone who may not (checked first).
    expect((await A.request.get(photo(newer.id), { headers: { ...bypassHeaders, "if-none-match": `"m-${newer.id}-f"` } })).status()).toBe(304);
    expect((await R.request.get(photo(newer.id, "t"), { headers: bypassHeaders })).status()).toBe(200);

    // Someone who left: the older one yes, the newer one no.
    expect((await M.request.get(photo(older.id), { headers: bypassHeaders })).status()).toBe(200);
    const left = await M.request.get(photo(newer.id), { headers: bypassHeaders });
    expect(left.status()).toBe(404);
    expect(left.headers()["cache-control"]).toBe("private, no-store");
    expect((await M.request.get(photo(newer.id), { headers: { ...bypassHeaders, "if-none-match": `"m-${newer.id}-f"` } })).status()).toBe(404);

    // An outsider (signed in, not in the group) and a signed-out visitor.
    expect((await N.request.get(photo(older.id), { headers: bypassHeaders })).status()).toBe(404);
    const anon = await pwRequest.newContext({ baseURL, extraHTTPHeaders: bypassHeaders });
    expect((await anon.get(photo(older.id))).status()).toBe(404);
    expect((await anon.get(photo(newer.id, "t"))).status()).toBe(404);
    await anon.dispose();

    // The group page: a strip with the count, and the Our moments page without the tab bar. Ravi can add; Meera can look back only.
    await R.goto(g.path);
    await settled(R);
    await expect(R.locator("[data-moments-strip]")).toContainText("Our moments");
    await expect(R.getByRole("link", { name: "Add a moment" })).toBeVisible();
    await R.locator("[data-moments-strip] a").first().click();
    await R.waitForURL(/\/moments$/);
    await settled(R);
    await expect(R.getByRole("heading", { name: "Our moments" })).toHaveCount(1);
    await expect(R.locator("[data-moment]")).toHaveCount(1); // the newest as a big card
    await expect(R.locator("[data-moment-row]")).toHaveCount(1); // the older as a row
    await expect(R.getByRole("link", { name: "Add your moment" })).toBeVisible();
    await expect(R.locator("[data-bottom-nav]")).toHaveCount(0);

    await M.goto(`${g.path}/moments`);
    await settled(M);
    await expect(M.locator("[data-moment]")).toHaveCount(1);
    await expect(M.getByText("The older one")).toBeVisible();
    await expect(M.getByText("The newer one")).toHaveCount(0);
    await expect(M.getByRole("link", { name: "Add your moment" })).toHaveCount(0);

    // A stranger can't even open the page.
    const res = await N.goto(`${g.path}/moments`);
    expect(res?.status()).toBe(404);
    const res2 = await N.goto(`${g.path}/moments/${newer.id}`);
    expect(res2?.status()).toBe(404);
  } finally {
    await db.momentReaction.deleteMany({ where: { moment: { groupId: gid } } });
    await db.moment.deleteMany({ where: { groupId: gid } });
  }
});
