import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BILL_DUE_DAYS, billDueNeeds, needLine, postcardNeed, type NeedItem } from "@/lib/home/need-line";

// Home's one "needs you" line now also carries what the sliding cards at the top of Home used to surface: a flat bill due soon and a postcard
// that arrived. Days are written out by hand: "today" below is Sat 14 Nov 2026.
const today = "2026-11-14";
const item = (kind: NeedItem["kind"], text: string, href = "/x", action = "Open"): NeedItem => ({ key: `${kind}:${text}`, kind, text, action, href });
const bill = (name: string, due: string, billId = name.toLowerCase()) => ({ groupId: "g1", billId, name, group: "Flat 402", due });

describe("bills due soon", () => {
  it("due today, tomorrow and in 3 days are needs; in 4 days, or already past, are not", () => {
    const needs = billDueNeeds([bill("Rent", "2026-11-14"), bill("Wi-Fi", "2026-11-15"), bill("Gas", "2026-11-17"), bill("Water", "2026-11-18"), bill("Old", "2026-11-13")], today);
    expect(BILL_DUE_DAYS).toBe(3);
    expect(needs.map((n) => n.text)).toEqual(["Rent is due today", "Wi-Fi is due tomorrow", "Gas is due in 3 days"]);
  });
  it("soonest first, linking to the bill itself, with the bill's own button words", () => {
    const [first] = billDueNeeds([bill("Gas", "2026-11-16", "b2"), bill("Wi-Fi", "2026-11-15", "b1")], today);
    expect(first).toMatchObject({ kind: "bill-due", text: "Wi-Fi is due tomorrow", action: "See bill", href: "/groups/g1/bills/b1" });
  });
  it("no bills, no needs; a day that isn't a date is ignored", () => {
    expect(billDueNeeds([], today)).toEqual([]);
    expect(billDueNeeds([bill("Odd", "soon")], today)).toEqual([]);
  });
});

describe("postcards", () => {
  it("one waiting, several waiting, none", () => {
    expect(postcardNeed(1)).toMatchObject({ kind: "postcard", text: "A postcard is waiting for you", href: "/postcards" });
    expect(postcardNeed(3)?.text).toBe("3 postcards are waiting for you");
    expect(postcardNeed(0)).toBeNull();
    expect(postcardNeed(-2)).toBeNull();
  });
});

describe("the one line", () => {
  it("nothing needs you: no line", () => expect(needLine([])).toBeNull());
  it("one thing: that thing, with its own link and words", () => {
    expect(needLine([item("postcard", "A postcard is waiting for you", "/postcards", "Open")])).toEqual({ text: "A postcard is waiting for you", action: "Open", href: "/postcards", count: 1 });
  });
  it("a bill due soon and a postcard: the bill first (more urgent), and 1 more", () => {
    const line = needLine([item("postcard", "A postcard is waiting for you", "/postcards"), item("bill-due", "Wi-Fi is due tomorrow", "/groups/g1/bills/b1", "See bill")]);
    expect(line).toEqual({ text: "Wi-Fi is due tomorrow, and 1 more", action: "See bill", href: "/groups/g1/bills/b1", count: 2 });
  });
  it("things only you can answer come before a bill or a postcard, and the 'ready to close' nudge comes last", () => {
    const line = needLine([item("close", "Goa is all square.", "/groups/g2/settings#close", "Close it"), item("postcard", "A postcard is waiting for you"), item("bill-due", "Rent is due today"), item("collect", "Meera says she paid ₹300", "/c/abc", "Check"), item("claim", "Kabir says they paid you ₹500", "/groups/g1/settle", "Confirm")]);
    expect(line).toEqual({ text: "Kabir says they paid you ₹500, and 4 more", action: "Confirm", href: "/groups/g1/settle", count: 5 });
  });
  it("a trailing full stop is not left in the middle: 'Goa is all square, and 1 more'", () => {
    expect(needLine([item("close", "Goa is all square.", "/g", "Close it"), item("postcard", "A postcard is waiting for you")])?.text).toBe("A postcard is waiting for you, and 1 more");
    expect(needLine([item("close", "Goa is all square.", "/g", "Close it"), item("close", "Pune is all square.", "/h", "Close it")])?.text).toBe("Goa is all square, and 1 more");
  });
  it("several payments only: '3 payments to confirm', See them, opens Alerts (as before)", () => {
    const line = needLine([item("claim", "a"), item("claim", "b"), item("payment", "c")]);
    expect(line).toEqual({ text: "3 payments to confirm", action: "See them", href: "/notifications", count: 3 });
  });
  it("several answers only you can give (a payment and a bill waiting for its amount): '2 things need you', Alerts (as before)", () => {
    expect(needLine([item("claim", "a"), item("bill", "b")])).toMatchObject({ text: "2 things need you", action: "See them", href: "/notifications", count: 2 });
  });
  it("the order of two of the same kind is kept (first in, first shown)", () => {
    expect(needLine([item("postcard", "first"), item("postcard", "second")])?.text).toBe("first, and 1 more");
  });
});

describe("Home uses it", () => {
  const home = readFileSync("src/app/(home)/page.tsx", "utf8");
  it("reads the bills due and the unread postcards, and draws the one line", () => {
    expect(home).toContain("billDueNeeds(dueSoon, today)");
    expect(home).toContain("unreadPostcards(");
    expect(home).toContain("needLine(needItems)");
    expect(home).toContain("loadNeedsYou(memberships, a, 0, new Date(), dueSoon)");
  });
  it("the bill read adds to dueSoon only for bills that are coming up and yours (or nobody's), never daily ones", () => {
    const needs = readFileSync("src/lib/needs-you.ts", "utf8");
    expect(needs).toContain('b.status === "upcoming" && b.bill.nature !== "daily" && (b.payerId === m.id || !b.payerId)');
  });
});
