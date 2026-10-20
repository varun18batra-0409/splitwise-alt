import { test, expect } from "../fixtures";
import type { BrowserContext, Page } from "@playwright/test";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { allowTestCopy, contextFor, createGroup, emailedLink, joinGroup, settled } from "../helpers/app";

// Stage 1 · Bringing people in: link, email, people already on Loopin, and
// someone added by name taking over their name.
test.describe.configure({ mode: "serial" });

let hostCtx: BrowserContext;
let host: Page;
let g = { path: "", invite: "" };

test.beforeAll(async ({ browser }) => {
  const user = await signUp("Hana", testEmail("host"));
  hostCtx = await contextFor(browser, user);
  host = await hostCtx.newPage();
  g = await createGroup(host, groupName("Invites"));
});
test.afterAll(async () => hostCtx?.close());

const members = async () => {
  const { db } = await import("../helpers/db");
  const id = g.path.split("/").pop()!;
  return db.member.findMany({ where: { groupId: id }, select: { id: true, name: true, accountId: true } });
};

test("an invite link: without signing in you can't join (no name box); after signing in, Join adds you", async ({ browser, page, context }) => {
  await allowTestCopy(context);
  await page.goto(g.invite);
  await settled(page);
  await expect(page.getByRole("link", { name: /sign up to join/i })).toBeVisible();
  await expect(page.locator('input[name="name"]')).toHaveCount(0);

  const ivan = await signUp("Ivan", testEmail("ivan"));
  const ictx = await contextFor(browser, ivan);
  await joinGroup(await ictx.newPage(), g.invite, g.path);
  await ictx.close();
  expect((await members()).map((m) => m.name)).toContain("Ivan");
});

test("invite by email: listed as “Invited”, not a member until they open the email and join", async ({ browser }) => {
  const email = testEmail("jaya");
  await host.goto(`${g.path}/invite`);
  await settled(host);
  const since = new Date(Date.now() - 2_000);
  await host.getByLabel("Email addresses to invite").fill(email);
  await host.getByRole("button", { name: "Invite", exact: true }).click();
  await host.waitForURL(/invited=/);
  await expect(host.getByText("Invited · waiting to join")).toBeVisible();
  expect((await members()).map((m) => m.name)).not.toContain("Jaya");

  const link = await emailedLink(email, since);
  const jaya = await signUp("Jaya", email);
  const jctx = await contextFor(browser, jaya);
  await joinGroup(await jctx.newPage(), link, g.path);
  await jctx.close();
  expect((await members()).map((m) => m.name)).toContain("Jaya");
});

test("someone you share a group with is found by name and added straight away; a stranger only by full email", async ({ browser }) => {
  // Kabir shares the first group with Hana, then Hana adds him to a second one by name.
  const kabir = await signUp("Kabir", testEmail("kabir"));
  const kctx = await contextFor(browser, kabir);
  await joinGroup(await kctx.newPage(), g.invite, g.path);
  await kctx.close();
  await signUp("Stranger Sam", testEmail("sam")); // on Loopin, but shares nothing with Hana

  const g2 = await createGroup(host, groupName("Second"));
  await host.goto(`${g2.path}/invite`);
  await settled(host);
  const search = host.getByLabel("Search people on Loopin");
  await search.fill("Stranger Sam");
  await expect(host.getByText(/Not someone you share a group with/)).toBeVisible();
  await search.fill("Kabir");
  await expect(host.getByText("On Loopin ✓").first()).toBeVisible();
  await host.getByRole("button", { name: "Add", exact: true }).first().click();
  await host.waitForURL(/added=Kabir/);
});

test("someone added by name: “not on Loopin yet” → Invite by email → they sign up and take over that name", async ({ browser }) => {
  const { db } = await import("../helpers/db");
  const gid = g.path.split("/").pop()!;
  const rohan = await db.member.create({ data: { groupId: gid, name: "Rohan" } }); // as if brought over from Splitwise
  const email = testEmail("rohan");

  await host.goto(`${g.path}/people`);
  await settled(host);
  const row = host.locator("details").filter({ hasText: "Rohan" }).first();
  await expect(row.getByText("not on Loopin yet")).toBeVisible();
  await row.locator("summary").click();
  const since = new Date(Date.now() - 2_000);
  await row.getByLabel("Rohan’s email").fill(email);
  await row.getByRole("button", { name: "Invite", exact: true }).click();
  await host.waitForURL(/invited=/);

  const link = await emailedLink(email, since);
  expect(link).toContain(`as=${rohan.id}`);
  const user = await signUp("Rohan", email);
  const rctx = await contextFor(browser, user);
  const rp = await rctx.newPage();
  await rp.goto(link);
  await settled(rp);
  await expect(rp.getByText(/You were added as/)).toBeVisible();
  await rp.getByRole("button", { name: "Continue as Rohan" }).click();
  await rp.waitForURL(new RegExp(`${g.path}$`));
  await rctx.close();
  const after = await db.member.findUniqueOrThrow({ where: { id: rohan.id } });
  expect(after.accountId).toBeTruthy();
});
