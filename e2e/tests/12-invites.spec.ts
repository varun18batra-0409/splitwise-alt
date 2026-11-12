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
  await expect(page.getByRole("link", { name: /^Continue with email$/i })).toBeVisible();
  await expect(page.locator('input[name="name"]')).toHaveCount(0);

  const ivan = await signUp("Ivan", testEmail("ivan"));
  const ictx = await contextFor(browser, ivan);
  await joinGroup(await ictx.newPage(), g.invite, g.path);
  await ictx.close();
  expect((await members()).map((m) => m.name)).toContain("Ivan");
});

// Batch B: adding by email puts a name in the group at once and sends an invitation. The invitee sees a
// card on Home; the group is theirs only after Join.
test("add by email: in the group at once as a name; the invitee gets a Join card on Home and Join brings the group in", async ({ browser }) => {
  const email = testEmail("jaya");
  const jaya = await signUp("Jaya", email); // already on Loopin
  const jctx = await contextFor(browser, jaya);
  const jp = await jctx.newPage();

  await host.goto(`${g.path}/invite`);
  await settled(host);
  await host.getByLabel("Email addresses to invite").fill(email);
  await host.getByRole("button", { name: "Invite", exact: true }).click();
  await host.waitForURL(/invited=/);
  // The adder's reply, and the name in the list.
  await expect(host.locator("[data-invited-title]")).toContainText("is in the group");
  await expect(host.getByText(`We’re emailing an invitation to ${email}`)).toBeVisible();
  await expect(host.getByText("Invited · hasn’t joined yet").first()).toBeVisible();
  const row = (await members()).find((m) => m.accountId === null && m.name.endsWith("Jaya"));
  expect(row, "a name-only row for the invited person").toBeTruthy();

  // The invitee: a card on Home, the group not in their groups yet.
  await jp.goto("/");
  await settled(jp);
  const card = jp.locator("[data-invitation]").filter({ hasText: "Hana added you to" });
  await expect(card).toHaveCount(1);
  await expect(card.getByRole("button", { name: "Join", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Not now", exact: true })).toBeVisible();
  // Opening the group meanwhile shows the invitation, not the group (no names, no amounts).
  await jp.goto(g.path);
  await settled(jp);
  await expect(jp.locator("[data-pending-group]")).toBeVisible();
  await expect(jp.getByText("Hana added you to this group.")).toBeVisible();

  await jp.getByRole("button", { name: /^Join / }).click();
  // Same address before and after, so wait for the invitation screen to be replaced by the group.
  await expect(jp.locator("[data-pending-group]")).toHaveCount(0, { timeout: 15_000 });
  const { db } = await import("../helpers/db");
  expect((await members()).find((m) => m.id === row!.id)?.accountId).toBe((await db.account.findUniqueOrThrow({ where: { email } })).id);
  await jp.goto("/");
  await settled(jp);
  await expect(jp.locator("[data-invitation]")).toHaveCount(0);
  await jctx.close();
});

test("add by email, then Not now: the card goes away and the group never appears for them; the name stays", async ({ browser }) => {
  const email = testEmail("noor");
  const noor = await signUp("Noor", email);
  const nctx = await contextFor(browser, noor);
  const np = await nctx.newPage();

  await host.goto(`${g.path}/invite`);
  await settled(host);
  await host.getByLabel("Email addresses to invite").fill(email);
  await host.getByRole("button", { name: "Invite", exact: true }).click();
  await host.waitForURL(/invited=/);

  await np.goto("/notifications"); // the same card is in Alerts
  await settled(np);
  await expect(np.locator("[data-invitation]")).toHaveCount(1);
  await np.locator("[data-invitation]").getByRole("button", { name: "Not now", exact: true }).click();
  await np.waitForURL((u) => u.pathname === "/");
  await expect(np.locator("[data-invitation]")).toHaveCount(0);
  await np.goto("/notifications");
  await settled(np);
  await expect(np.locator("[data-invitation]")).toHaveCount(0);
  // Not in their groups: the group's address says "private".
  await np.goto(g.path);
  await np.waitForURL(/\/private/);
  // The name is still in the group, unlinked.
  expect((await members()).some((m) => m.accountId === null && m.name.endsWith("Noor"))).toBe(true);
  await nctx.close();
});

test("someone you share a group with is found by name and added (in the group at once, invited); a stranger only by full email", async ({ browser }) => {
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
  await host.waitForURL(/invited=/);
  await expect(host.locator("[data-invited-title]")).toContainText("Kabir is in the group");
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
  await row.locator(":scope > summary").click(); // its own summary, not the nested "What stays, what goes"
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
