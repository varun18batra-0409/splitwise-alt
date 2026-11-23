import { afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The Collect link notice (founder-approved mockup) and the privacy page's Collect links item. These draw the real pages.
const who = vi.hoisted(() => ({ account: null as null | { id: string } }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test" }),
}));
vi.mock("@/lib/identity", async (orig) => ({ ...(await orig<typeof import("@/lib/identity")>()), getAccount: async () => who.account }));

const { db } = await import("@/lib/db");
const { createCollection, markPaid, loadCollection } = await import("@/lib/collect");
const { default: CollectionPage } = await import("@/app/c/[code]/page");
const { default: Privacy } = await import("@/app/privacy/page");

const NOTICE = "Anyone with this link sees the names, amounts and ticks.";
const emails: string[] = [];
afterAll(async () => {
  const accs = await db.account.findMany({ where: { email: { in: emails } } });
  await db.collection.deleteMany({ where: { accountId: { in: accs.map((a) => a.id) } } });
  await db.account.deleteMany({ where: { email: { in: emails } } });
});
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "’").replace(/\s+/g, " ");

describe("the notice under Share collection link", () => {
  it("shows to the organiser, under the share button, and not to anyone else", async () => {
    const email = `notice-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    emails.push(email);
    const asha = await db.account.create({ data: { email, name: "Asha" } });
    const made = await createCollection(asha, { title: "Farewell gift", note: "", currency: "INR", amount: "", dueDate: "", upiId: "asha@okicici", payLink: "", names: "Ravi\nMeera" });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const render = async () => renderToStaticMarkup(await CollectionPage({ params: Promise.resolve({ code: made.code }), searchParams: Promise.resolve({}) }));

    who.account = { id: asha.id };
    const mine = await render();
    expect(text(mine)).toContain(NOTICE);
    expect(mine).toContain('data-collect-link-note');
    expect(mine.indexOf("Share collection link")).toBeLessThan(mine.indexOf(NOTICE)); // directly under the button
    expect(mine.indexOf(NOTICE)).toBeLessThan(mine.indexOf("Close collection"));

    who.account = null;
    expect(text(await render())).not.toContain(NOTICE); // a person with the link doesn't see the organiser's note
  });
});

describe("the privacy page", () => {
  const page = text(renderToStaticMarkup(Privacy()));
  it("has a Collect links item in who can see what, and says each person's amount is shown", async () => {
    expect(page).toContain("Collect links: a collection’s link opens without signing in.");
    expect(page).toContain("how much each person says they paid");
    expect(page).toContain("Phone numbers stay with the organiser.");
    expect(page).toContain("Anyone with the link can tick a name or add their own, so send it only to the people paying.");
    expect(page).toContain("the organiser’s name and note, the amount, the due date, the totals so far, whether it’s closed");
    expect(page).toContain("who paid in cash");
    expect(page).toContain("so only that phone can undo the tick.");
    expect(page.indexOf("Collect links:")).toBeGreaterThan(page.indexOf("Who can see what"));
    expect(page.indexOf("Collect links:")).toBeLessThan(page.indexOf("If you leave a group:"));
  });
  it("the contacts sentence mentions collections", () => {
    expect(page).toContain("are saved to the group, or to the collection you’re adding them to (only the organiser sees those numbers). Loopin never uploads your address book.");
  });
  it("the claim is true: the public list shows each person's amount, for an any-amount collection too", async () => {
    const email = `notice2-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    emails.push(email);
    const asha = await db.account.create({ data: { email, name: "Asha" } });
    const made = await createCollection(asha, { title: "Trip kitty", note: "", currency: "INR", amount: "", dueDate: "", upiId: "", payLink: "", names: "Ravi" });
    if (!made.ok) throw new Error("not made");
    const c = (await loadCollection(made.code))!;
    expect((await markPaid(made.code, { entryId: c.entries[0].id, amount: "450" }, "phone-ravi")).ok).toBe(true);
    who.account = null;
    const html = text(renderToStaticMarkup(await CollectionPage({ params: Promise.resolve({ code: made.code }), searchParams: Promise.resolve({}) })));
    expect(html).toContain("₹450"); // Ravi's own 45,000 paise is on the public list
  });
});
