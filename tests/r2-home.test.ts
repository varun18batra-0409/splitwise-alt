import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { alsoLine, homeTicket, moneyPeople, orderPasses, passFields, personCode, routeCode, shortDay, sideFacts, type InvolvedGroup, type MoneyMode, type PeopleGroup } from "@/lib/home/money-card";

// R2: Home's boarding pass and a calmer Home. Amounts are minor units (paise): 420000 paise = ₹4,200.
const src = (p: string) => readFileSync(`${__dirname}/../${p}`, "utf8");
const person = (id: string, name: string) => ({ id, name, phone: "", accountId: `acc-${id}` });
const me = { id: "me", name: "Me", phone: "", accountId: "acc-me" };
const grp = (groupId: string, groupName: string, iPay: [string, string, number][], theyPay: [string, string, number][] = []): PeopleGroup => ({
  groupId,
  groupName,
  currency: "INR",
  myId: "me",
  members: [me, ...iPay.map(([id, n]) => person(id, n)), ...theyPay.map(([id, n]) => person(id, n))],
  transfers: [...iPay.map(([id, , amount]) => ({ from: "me", to: id, amount })), ...theyPay.map(([id, , amount]) => ({ from: id, to: "me", amount }))],
});
const ticketFor = (groups: PeopleGroup[], mode: MoneyMode) =>
  homeTicket({
    mode,
    acrossCurrencies: false,
    owe: moneyPeople(groups, "owe", "INR", (n) => n),
    owed: moneyPeople(groups, "owed", "INR", (n) => n),
    common: "INR",
    hero: { text: "₹1" },
    groups: groups.map((g): InvolvedGroup => ({ id: g.groupId, name: g.groupName, type: "trip", weight: 1 })),
  });

describe("route codes", () => {
  it("first three letters of the first name, capitals; YOU for you; N PPL for several", () => {
    expect(personCode("Kabir Rao")).toBe("KAB");
    expect(routeCode("Kabir")).toBe("KAB");
    expect(routeCode("You")).toBe("YOU");
    expect(routeCode("3 people")).toBe("3 PPL");
    expect(personCode("Al")).toBe("AL");
  });
  it("a name whose code is YOU falls back, so the two ends are never alike: Youssef Khan is YKH, Youssef alone is YO2", () => {
    expect(personCode("Youssef Khan", ["YOU"])).toBe("YKH");
    expect(personCode("Youssef", ["YOU"])).toBe("YO2");
    expect(personCode("You Khan", ["YOU", "YKH"])).toBe("YOK");
  });
  it("long names stay three letters: Bhagyalakshmi Venkataraman is BHA", () => {
    expect(personCode("Bhagyalakshmi Venkataraman")).toBe("BHA");
  });
  it("on the ticket: Kabir owes you is KAB to YOU; you owe Asha is YOU to ASH; three owe you is 3 PPL to YOU", () => {
    const owed = ticketFor([grp("g1", "Flat", [], [["k", "Kabir Rao", 1000]])], "owed");
    expect(owed.kind === "one" && [owed.line.fromCode, owed.line.toCode]).toEqual(["KAB", "YOU"]);
    const owe = ticketFor([grp("g1", "Goa", [["a", "Asha Rao", 1000]])], "owe");
    expect(owe.kind === "one" && [owe.line.fromCode, owe.line.toCode]).toEqual(["YOU", "ASH"]);
    const many = ticketFor([grp("g1", "Flat", [], [["a", "Asha", 1], ["k", "Kabir", 2], ["m", "Meera", 3]])], "owed");
    expect(many.kind === "one" && [many.line.fromCode, many.line.toCode]).toEqual(["3 PPL", "YOU"]);
  });
  it("Youssef owes you: YKH to YOU, not YOU to YOU", () => {
    const t = ticketFor([grp("g1", "Flat", [], [["y", "Youssef Khan", 1000]])], "owed");
    expect(t.kind === "one" && [t.line.fromCode, t.line.toCode]).toEqual(["YKH", "YOU"]);
  });
  it("the codes never truncate: no truncate or ellipsis class on them, and they do not shrink", () => {
    const hm = src("src/components/HomeMoney.tsx");
    const route = hm.slice(hm.indexOf("function PassRoute"), hm.indexOf("function PassFields"));
    expect(route).toContain("shrink-0 whitespace-nowrap");
    expect(route).not.toContain("truncate");
  });
});

describe("the fields", () => {
  it("one group, a date and a count: Group, Since, Items, in that order, sentence-case labels", () => {
    expect(passFields({ groupNames: ["Thailand trip"], since: "2026-11-03", items: 7, thisYear: "2026" })).toEqual([
      { key: "group", label: "Group", value: "Thailand trip" },
      { key: "since", label: "Since", value: "3 Nov" },
      { key: "items", label: "Items", value: "7" },
    ]);
  });
  it("several groups say how many; unknown or zero fields are left out (never 0 items)", () => {
    expect(passFields({ groupNames: ["A", "B", "C"], since: null, items: 0, thisYear: "2026" })).toEqual([{ key: "group", label: "Groups", value: "3 groups" }]);
    expect(passFields({ groupNames: [], since: null, items: null, thisYear: "2026" })).toEqual([]);
  });
  it("an old date keeps its year", () => {
    expect(shortDay("2025-12-28", "2026")).toBe("28 Dec 2025");
    expect(shortDay("2026-01-05", "2026")).toBe("5 Jan");
  });
  it("across groups: the oldest day and the items added up (3 + 2 = 5); a group with no facts is skipped", () => {
    const f = { a: { since: "2026-11-09", items: 3 }, b: { since: "2026-10-30", items: 2 } };
    expect(sideFacts(["a", "b", "zzz"], f)).toEqual({ since: "2026-10-30", items: 5 });
    expect(sideFacts(["zzz"], f)).toEqual({ since: null, items: null });
  });
  it("labels are written in sentence case and never forced to capitals (only the codes and the stamp are)", () => {
    const hm = src("src/components/HomeMoney.tsx");
    expect(hm).not.toContain("uppercase");
    expect(hm).toContain(">From</span>");
    expect(hm).toContain(">To</span>");
  });
});

describe("both ways: two passes, the larger first", () => {
  it("you owe Nupur ₹4,200 (420000) and Kabir owes you ₹22,916 (2291600): the owed pass comes first", () => {
    const t = ticketFor([grp("g1", "Flat", [["n", "Nupur", 420000]], [["k", "Kabir", 2291600]])], "owed");
    expect(t.kind).toBe("both");
    if (t.kind !== "both") return;
    expect(orderPasses(t.lines).map((l) => l.side)).toEqual(["owed", "owe"]);
    expect(orderPasses(t.lines)[0].amount).toBe("₹22,916");
  });
  it("you owe ₹5,000 and are owed ₹1,200: the owe pass is first", () => {
    const t = ticketFor([grp("g1", "Goa", [["n", "Nupur", 500000]], [["k", "Kabir", 120000]])], "owe");
    if (t.kind !== "both") throw new Error("both");
    expect(orderPasses(t.lines).map((l) => l.side)).toEqual(["owe", "owed"]);
  });
  it("equal amounts: what you owe first", () => {
    const t = ticketFor([grp("g1", "Goa", [["n", "Nupur", 100000]], [["k", "Kabir", 100000]])], "even");
    if (t.kind !== "both") throw new Error("both");
    expect(orderPasses(t.lines).map((l) => l.side)).toEqual(["owe", "owed"]);
  });
  it("the stack scrolls by hand: snap, keyboard, dots, no timer; one cream button (only the first pass)", () => {
    const st = src("src/components/PassStack.tsx");
    expect(st).toContain("snap-x snap-mandatory");
    expect(st).toContain("tabIndex={0}");
    expect(st).toContain("ArrowRight");
    expect(st).toContain("prefers-reduced-motion");
    expect(st).not.toContain("setInterval");
    expect(src("src/components/HomeMoney.tsx")).toContain("bright={i === 0}");
  });
});

describe("all square and the neutral card", () => {
  it("square has the SETTLED stamp (not green), one quiet Add an expense link and no button", () => {
    const hm = src("src/components/HomeMoney.tsx");
    expect(hm).toContain("data-settled-stamp");
    expect(hm).toContain("SETTLED");
    const stamp = hm.slice(hm.indexOf("data-settled-stamp"), hm.indexOf("SETTLED"));
    expect(stamp).not.toMatch(/text-owed|text-owe\b/);
    expect(hm).toContain("data-square-add");
    expect(hm).toContain("Add an expense");
  });
  it("only the money uses the ticket shape: the Also coming up card has no perforation or notches", () => {
    const c = src("src/components/TripCountdown.tsx");
    expect(c).not.toContain("border-l-2 border-dashed");
    expect(c).not.toContain("half-circle");
    expect(c).not.toContain("uppercase");
  });
});

describe("the pass drawing", () => {
  it("notches are 16px half circles top and bottom; dashed perforation at 25%; barcode strip is decorative", () => {
    const hm = src("src/components/HomeMoney.tsx");
    expect(hm.match(/data-notch/g)).toHaveLength(2);
    expect(hm).toContain("h-4 w-4 rounded-full");
    expect(hm).toContain("border-dashed border-fg/25");
    expect(hm).toContain("fill-fg/20");
    expect(hm.slice(hm.indexOf("function Barcode"), hm.indexOf("export function TicketShell"))).toContain("aria-hidden");
  });
});

describe("a calmer Home", () => {
  const home = src("src/app/(home)/page.tsx");
  it("header is the wordmark and the bell; install and help moved to You", () => {
    expect(home).not.toContain("GetAppButton");
    expect(home).not.toContain('href="/how-it-works" aria-label');
    expect(home).toContain("<BellButton");
    const you = src("src/app/account/page.tsx");
    expect(you).toContain("<GetAppButton");
    expect(you).toContain('href="/how-it-works"');
  });
  it("one countdown with an Also line; no TripRow, no Also coming up cards, no Plan a trip card; the sliding Home cards are back", () => {
    expect(home).toContain("alsoLine(");
    expect(home).not.toContain("TripRow");
    expect(home).not.toContain("Also coming up");
    expect(home).not.toContain("Plan a trip");
    expect(home).toContain("<HomeBanner>");
    expect(home).toContain("homeHighlights(");
    expect(home).toContain("data-month-card");
  });
  it("the Also line: Manali in 40 days; two trips and a third say 'and 1 more'", () => {
    expect(alsoLine([])).toBe("");
    expect(alsoLine([{ place: "Manali", days: 40 }])).toBe("Also: Manali in 40 days");
    expect(alsoLine([{ place: "Manali", days: 40 }, { place: "Goa", days: 1 }, { place: "Bali", days: 90 }])).toBe("Also: Manali in 40 days, Goa tomorrow and 1 more");
  });
  it("no story circle for a coming trip's countdown", () => {
    expect(home).toContain('trips.filter((t) => t.phase.kind !== "before")');
  });
  it("the need line is full contrast, two lines at most, with a small dot, no arrow", () => {
    const hm = src("src/components/HomeMoney.tsx");
    expect(hm).toContain("data-need-dot");
    expect(hm).toContain("line-clamp-2");
    expect(hm).not.toContain("font-medium text-fg/55");
  });
  it("one dismissible sign-in banner, remembered in a try/catch", () => {
    expect(home).toContain("<SignInBanner");
    const b = src("src/components/SignInBanner.tsx");
    expect(b).toContain("localStorage.setItem(SIGNIN_BANNER_KEY");
    expect(b.match(/try \{/g)?.length).toBeGreaterThanOrEqual(2);
    expect(b).toContain("catch");
  });
});

describe("follow-ups from batch 1", () => {
  it("the organiser's Collections page shows '₹300 to check' in neutral grey; Home does not", () => {
    const card = src("src/components/CollectionsList.tsx");
    expect(card).toContain("showToCheck");
    expect(card).toContain("{formatMoney(p.reportedAmount, c.currency)} to check");
    expect(card).toContain("text-fg/60");
    expect(card).not.toContain("text-owed");
    expect(src("src/app/collect/page.tsx")).toContain("showToCheck");
    expect(src("src/app/(home)/page.tsx")).not.toContain("showToCheck");
  });
});
