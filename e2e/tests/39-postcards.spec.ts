import { test, expect } from "../fixtures";
import { baseURL, bypassHeaders, testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { allowTestCopy, contextFor, createGroup, joinGroup, settled } from "../helpers/app";
import { addExpense } from "../helpers/expense";

// Postcards: Asha writes one from the group to Ravi (they share a group); Ravi finds it in his
// postcards (below the passport), opens it, turns it over and can write back. Someone else can't open it.
test("Postcards: write from a group, the other person receives it, turns it over, a stranger can't see it", async ({ browser }) => {
  test.setTimeout(150_000);
  const asha = await signUp("Asha", testEmail("pc-asha"));
  const ravi = await signUp("Ravi", testEmail("pc-ravi"));
  const A = await (await contextFor(browser, asha)).newPage();
  const R = await (await contextFor(browser, ravi)).newPage();
  const g = await createGroup(A, groupName("Goa trip"), "Trip");
  await joinGroup(R, g.invite, g.path);

  // The group offers it, once something has happened in it (an empty group shows how to start instead).
  await addExpense(A, g.path, { name: "Beach shack lunch", amount: "800" });
  await A.goto(g.path);
  await settled(A);
  await A.locator("[data-send-postcard]").first().click();
  await A.waitForURL(/\/postcards\/new\?group=/);
  await settled(A);
  // Front: a print instead of the photo (the Photo tool is open first), then each tool in turn, then the back.
  await A.getByRole("button", { name: "Print: Mountains" }).click();
  await expect(A.locator("[data-postcard-front] [data-print-svg]").first()).toBeVisible();
  await A.locator('[data-tool="colour"]').click();
  await A.getByRole("button", { name: "Gold words" }).click();
  await A.locator('[data-tool="look"]').click();
  await A.getByRole("button", { name: "Look: Golden hour" }).click();
  await A.locator('[data-tool="touches"]').click();
  await A.getByRole("button", { name: "Tape", exact: true }).click();
  await expect(A.locator("[data-postcard-front] [data-touch='tape']").first()).toBeVisible();
  await A.getByRole("tab", { name: "Note" }).click();
  await A.getByRole("button", { name: "Same time next year?" }).click(); // the Message tool is open first
  await A.locator('[data-tool="pen"]').click();
  await A.getByRole("button", { name: "Bottle green ink" }).click();
  await A.getByRole("button", { name: "Wax seal", exact: true }).click();
  await A.getByRole("button", { name: "Gold wax", exact: true }).click();
  await A.getByRole("button", { name: "Seal design: Fleur-de-lis" }).click();
  await expect(A.getByRole("button", { name: "Seal design: Fleur-de-lis" })).toHaveAttribute("aria-pressed", "true");
  await A.locator('[data-tool="message"]').click();
  await A.getByRole("textbox", { name: "Your message" }).fill("Wish you were here. The beach shack was the fancy dinner.");
  await A.locator("[data-signoff]").fill("Asha & the gang");
  await A.getByRole("tab", { name: "Send" }).click();
  await A.locator("[data-recipient='Ravi']").click();
  await A.getByRole("button", { name: "Send to 1 person" }).click();
  await A.waitForURL(/\/postcards\/[a-z0-9]+\?sent=1/);
  const path = new URL(A.url()).pathname;
  await expect(A.getByText(/Sent\. It’s waiting in their postcards/)).toBeVisible();

  // Ravi: in his passport and on his shelf, marked new; opening it shows the message on the back.
  await R.goto("/account");
  await settled(R);
  await expect(R.locator("[data-postcards-link]")).toContainText("1 new");
  await R.goto(path);
  await settled(R);
  const flip = R.locator("[data-postcard-flip]");
  await expect(R.locator("[data-front-words]").first()).toHaveAttribute("data-tone", "gold");
  await expect(flip).toHaveAttribute("data-postcard-flip", "front");
  await flip.click();
  await expect(flip).toHaveAttribute("data-postcard-flip", "back");
  await expect(R.locator("[data-back-message]")).toContainText("fancy dinner");
  await expect(R.locator("[data-postcard-back]").first()).toContainText("Asha & the gang");
  await expect(R.locator("[data-postcard-back] [data-touch='seal']").first()).toBeAttached();
  await expect(R.getByRole("link", { name: "Write back" })).toBeVisible();
  // Ravi presses a wax seal back; Asha sees it on her card.
  await R.getByRole("button", { name: "Seal: Miss you" }).click();
  await R.waitForURL(/sealed=1/);
  await expect(R.locator("[data-reaction='miss']")).toBeVisible();
  // Ravi can reuse the design (not Asha's words) for someone else.
  await R.locator("[data-send-new]").click();
  await R.waitForURL(/\/postcards\/new\?from=/);
  await settled(R);
  await R.getByRole("tab", { name: "Note" }).click();
  await expect(R.getByRole("textbox", { name: "Your message" })).toHaveValue("");
  await R.goto("/postcards");
  await settled(R);
  await expect(R.locator("[data-postcard-item]")).toHaveCount(1);
  await A.goto(path);
  await settled(A);
  await expect(A.locator("[data-reaction='miss']")).toContainText("Miss you");

  // Asha sends the same card again, sealed until a day ahead: everything comes back filled in.
  await A.locator("[data-send-again]").click();
  await A.waitForURL(/\/postcards\/new\?from=/);
  await settled(A);
  await A.getByRole("tab", { name: "Note" }).click();
  await expect(A.getByRole("textbox", { name: "Your message" })).toHaveValue(/fancy dinner/);
  await A.getByRole("tab", { name: "Send" }).click();
  await A.getByRole("button", { name: "A year from today" }).click();
  await expect(A.locator("[data-sealed-note]")).toBeVisible();
  await A.locator("[data-recipient='Ravi']").click();
  await A.getByRole("button", { name: "Send to 1 person" }).click();
  await A.waitForURL(/\/postcards\/[a-z0-9]+\?sent=1/);
  const sealedPath = new URL(A.url()).pathname;
  expect(sealedPath).not.toBe(path);
  await R.goto(sealedPath);
  await settled(R);
  await expect(R.locator("[data-sealed]")).toBeVisible();
  await expect(R.locator("[data-back-message]")).toHaveCount(0);
  await R.goto("/postcards/stamps");
  await settled(R);
  await expect(R.locator("[data-album-count]")).toContainText("of 9 collected");

  // Someone who isn't the sender or the receiver gets nothing.
  const stranger = await signUp("Zed", testEmail("pc-zed"));
  const Z = await (await contextFor(browser, stranger)).newPage();
  const res = await Z.goto(path);
  expect(res?.status()).toBe(404);
  const anon = await browser.newContext();
  await allowTestCopy(anon);
  const N = await anon.newPage();
  await N.goto(path);
  await N.waitForURL(/\/signin/);
});

// A one-side card: no flip, 160 characters, a taped print in the size you pick. Ravi reads it as one picture and finds it on his shelf.
test("Postcards: a one-side card is written, sent, read and shelved", async ({ browser }) => {
  test.setTimeout(150_000);
  const asha = await signUp("Asha", testEmail("pc1-asha"));
  const ravi = await signUp("Ravi", testEmail("pc1-ravi"));
  const A = await (await contextFor(browser, asha)).newPage();
  const R = await (await contextFor(browser, ravi)).newPage();
  const g = await createGroup(A, groupName("One side trip"), "Trip");
  await joinGroup(R, g.invite, g.path);
  const gid = g.path.split("/").pop()!;

  await A.goto(`/postcards/new?group=${gid}`);
  await settled(A);
  await A.locator('[data-format-choice="oneside"]').click();
  await expect(A.getByRole("button", { name: "Flip", exact: true })).toHaveCount(0);
  await expect(A.getByRole("tab", { name: "Card" })).toHaveAttribute("aria-selected", "true");
  await expect(A.getByRole("tab", { name: "Send" })).toBeVisible();
  await expect(A.getByRole("tab", { name: "Note" })).toHaveCount(0);
  await expect(A.locator("[data-composer] [data-postcard-oneside]")).toBeVisible();

  // 161 characters: the count says so, and Next stays on the card and says why.
  await A.locator('[data-tool="message"]').click();
  const box = A.getByRole("textbox", { name: "Your message" });
  await box.fill("a".repeat(161));
  await expect(A.getByText("161 / 160")).toBeVisible();
  await expect(A.locator("[data-message-over]")).toBeVisible();
  await A.locator("[data-next]").click();
  await expect(A.getByRole("tab", { name: "Card" })).toHaveAttribute("aria-selected", "true");
  await expect(A.getByRole("status").filter({ hasText: "holds up to 160 characters" })).toBeVisible();

  const note = "Remember the bus that never came? Best wrong turn ever.".padEnd(60, "!");
  await box.fill(note);
  await expect(A.getByText("60 / 160")).toBeVisible();
  await A.locator('[data-tool="photo"]').click();
  await A.locator('[data-size-choice="medium"]').click();
  await expect(A.locator("[data-composer] [data-postcard-oneside]")).toHaveAttribute("data-photo-size", "medium");
  await A.locator("[data-next]").click();
  await expect(A.getByRole("tab", { name: "Send" })).toHaveAttribute("aria-selected", "true");
  await expect(A.locator("[data-whatsapp-anyone]")).toContainText("one picture");
  await A.locator("[data-recipient='Ravi']").click();
  await A.getByRole("button", { name: "Send to 1 person" }).click();
  await A.waitForURL(/\/postcards\/[a-z0-9]+\?sent=1/);
  const path = new URL(A.url()).pathname;

  // Ravi: one card, no flip, the message, and Write back.
  await R.goto(path);
  await settled(R);
  await expect(R.locator("[data-postcard-oneside]").first()).toHaveAttribute("data-photo-size", "medium");
  await expect(R.locator("[data-postcard-flip]")).toHaveCount(0);
  await expect(R.getByText("Tap the card to turn it over")).toHaveCount(0);
  await expect(R.locator("[data-back-message]")).toContainText("Best wrong turn ever");
  await expect(R.getByRole("link", { name: "Write back" })).toBeVisible();
  await R.goto("/postcards");
  await settled(R);
  await expect(R.locator("[data-postcard-item] [data-postcard-oneside]")).toHaveCount(1);
});

// Your uploads and My moments: an earlier upload comes back for its owner only; a moment photo is copied onto the card.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
test("Postcards: reuse an earlier upload (only yours) and send a photo from your own moment", async ({ browser }) => {
  test.setTimeout(240_000);
  const asha = await signUp("Asha", testEmail("pc2-asha"));
  const ravi = await signUp("Ravi", testEmail("pc2-ravi"));
  const A = await (await contextFor(browser, asha)).newPage();
  const R = await (await contextFor(browser, ravi)).newPage();
  const g = await createGroup(A, groupName("Reuse trip"), "Trip");
  await joinGroup(R, g.invite, g.path);
  const gid = g.path.split("/").pop()!;
  const { db } = await import("../helpers/db");

  const write = async (page: typeof A, text: string) => {
    await page.getByRole("tab", { name: "Note" }).click(); // the Message tool is open first on the Note
    await page.getByRole("textbox", { name: "Your message" }).fill(text);
  };
  const sendToRavi = async () => {
    await A.getByRole("tab", { name: "Send" }).click();
    await A.locator("[data-recipient='Ravi']").click();
    await A.getByRole("button", { name: "Send to 1 person" }).click();
    await A.waitForURL(/\/postcards\/[a-z0-9]+\?sent=1/);
  };
  const accountId = async (email: string) => (await db.account.findFirstOrThrow({ where: { email } })).id;
  const [ashaId, raviId] = [await accountId(asha.email), await accountId(ravi.email)];

  // Asha uploads a photo and sends it.
  await A.goto(`/postcards/new?group=${gid}`);
  await settled(A);
  await A.getByLabel("Choose your own photo").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
  await expect(A.getByRole("button", { name: "Your photo", exact: true })).toBeVisible();
  await write(A, "My own picture");
  await sendToRavi();
  const first = await db.postcard.findFirstOrThrow({ where: { fromId: ashaId }, orderBy: { createdAt: "desc" } });
  expect(first.photoId).not.toBe("");
  expect((await db.postcardPhoto.findUniqueOrThrow({ where: { id: first.photoId } })).accountId).toBe(ashaId);

  // The next card offers it again; choosing it reuses the same stored photo (no new copy).
  await A.goto(`/postcards/new?group=${gid}`);
  await settled(A);
  const again = A.locator(`[data-upload-choice="${first.photoId}"]`);
  await expect(again).toBeVisible();
  await again.click();
  await expect(again).toHaveAttribute("aria-pressed", "true");
  await write(A, "Same picture again");
  await sendToRavi();
  const second = await db.postcard.findFirstOrThrow({ where: { fromId: ashaId }, orderBy: { createdAt: "desc" } });
  expect(second.id).not.toBe(first.id);
  expect(second.photoId).toBe(first.photoId);
  expect(await db.postcardPhoto.count({ where: { id: first.photoId } })).toBe(1);

  // Ravi never sees Asha's upload in his editor (the server also refuses it: tests/postcard-editor-server.test.ts).
  await R.goto(`/postcards/new?group=${gid}`);
  await settled(R);
  await expect(R.locator("[data-upload-choice]")).toHaveCount(0);

  // One moment each, put straight in the database (the upload itself is covered elsewhere).
  const memberId = async (name: string) => (await db.member.findFirstOrThrow({ where: { groupId: gid, name } })).id;
  const add = async (name: string, accountId: string, caption: string) =>
    db.moment.create({ data: { groupId: gid, authorId: await memberId(name), authorAccountId: accountId, caption, type: "image/jpeg", width: 1, height: 1, data: TINY_JPEG, thumbData: TINY_JPEG } });
  const mine = await add("Asha", ashaId, "Asha on the boat");
  const his = await add("Ravi", raviId, "Ravi at the market");

  await A.goto(`/postcards/new?group=${gid}`);
  await settled(A);
  await expect(A.locator("[data-moment-choice]")).toHaveCount(1);
  await expect(A.locator(`[data-moment-choice="${his.id}"]`)).toHaveCount(0);
  await A.locator(`[data-moment-choice="${mine.id}"]`).click();
  await write(A, "From my moment");
  await sendToRavi();
  const third = await db.postcard.findFirstOrThrow({ where: { fromId: ashaId }, orderBy: { createdAt: "desc" } });
  expect(third.photoId).not.toBe(first.photoId); // a copy, not the moment itself
  expect((await db.postcardPhoto.findUniqueOrThrow({ where: { id: third.photoId } })).accountId).toBe(ashaId);

  // Asha deletes the moment: Ravi's card still shows its photo.
  await db.moment.delete({ where: { id: mine.id } });
  const photo = await R.request.get(`${baseURL}/api/postcard-photo/${third.photoId}`, { headers: bypassHeaders });
  expect(photo.status()).toBe(200);
  // Ravi sees his own moment in his editor, not Asha's.
  await R.goto(`/postcards/new?group=${gid}`);
  await settled(R);
  await expect(R.locator(`[data-moment-choice="${his.id}"]`)).toHaveCount(1);
  await expect(R.locator("[data-moment-choice]")).toHaveCount(1);
});

// The edit steps are one screen on a small phone: the page does not scroll and every tool is a comfortable target.
for (const size of [
  { width: 320, height: 640 },
  { width: 360, height: 780 },
]) {
  test(`Postcards: the editor fits a ${size.width} x ${size.height} phone with no page scroll`, async ({ browser }) => {
    test.setTimeout(120_000);
    const isha = await signUp("Isha", testEmail(`pc3-${size.width}`));
    const P = await (await contextFor(browser, isha)).newPage();
    await P.setViewportSize(size);
    await P.goto("/postcards/new");
    await settled(P);

    const check = async (where: string) => {
      const m = await P.evaluate(() => ({ scroll: (document.scrollingElement ?? document.documentElement).scrollHeight, inner: window.innerHeight, edit: document.querySelector("[data-composer]")?.getBoundingClientRect().bottom ?? 0 }));
      expect(m.scroll, `${where}: page scroll height ${m.scroll} vs window ${m.inner}`).toBeLessThanOrEqual(m.inner);
      expect(m.edit, `${where}: the editor stays inside the window`).toBeLessThanOrEqual(m.inner + 1);
      const tools = await P.locator("[data-tool]").all();
      expect(tools.length, where).toBeGreaterThanOrEqual(6);
      for (const t of tools) {
        const b = (await t.boundingBox())!;
        expect(b.width, `${where}: tool width`).toBeGreaterThanOrEqual(44);
        expect(b.height, `${where}: tool height`).toBeGreaterThanOrEqual(44);
      }
    };
    await check("Front");
    await P.getByRole("tab", { name: "Note" }).click();
    await check("Note");
    await P.getByRole("tab", { name: "Front" }).click();
    await P.locator('[data-format-choice="oneside"]').click();
    await expect(P.locator("[data-tool]")).toHaveCount(7);
    await check("Card");
  });
}
