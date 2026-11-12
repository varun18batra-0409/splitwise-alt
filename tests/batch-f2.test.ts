import { describe, expect, it } from "vitest";
import { tabTarget } from "@/lib/focus-trap";
import { noticeIdentity, noticeText } from "@/lib/notice-identity";
import { billAmountText, billEachText } from "@/lib/bill-preview";
import { MESSAGE_MAX, maxMessageLines, messageFit, overText, withOpener } from "@/lib/postcards/fit";
import { trimWindow, windowFor } from "@/lib/paging";
import { pickFriends } from "@/lib/friend-list";
import { backMoney, barSize, compactMoney, percentText, signedMoney } from "@/lib/chart-labels";
import { activityHref, activityMoreHref, dayLabel, filterChips } from "@/lib/activity";
import { opensLine } from "@/lib/postcards/opens";
import { countsLine, stampCounts } from "@/lib/collect-rules";
import { inviteLabel } from "@/lib/invite-label";
import { defaultPayment } from "@/lib/pay-default";
import { moveOutConfirm } from "@/lib/move-confirm";
import { recapScope } from "@/lib/recap-scope";
import { closeHint, sharesHint } from "@/lib/settings-words";
import { roundToWhole } from "@/lib/round-whole";
import { formatMoney } from "@/lib/money";
import { storyLines } from "@/lib/home/story-lines";
import { placeSlot } from "@/lib/places";

describe("focus trap (SEQ-UI-04)", () => {
  it("Tab on the last item goes to the first; Shift+Tab on the first goes to the last", () => {
    expect(tabTarget({ shift: false, index: 2, count: 3, inside: true })).toBe("first");
    expect(tabTarget({ shift: true, index: 0, count: 3, inside: true })).toBe("last");
  });
  it("in the middle the browser decides; from outside or the heading it is pulled back in", () => {
    expect(tabTarget({ shift: false, index: 1, count: 3, inside: true })).toBeNull();
    expect(tabTarget({ shift: true, index: 1, count: 3, inside: true })).toBeNull();
    expect(tabTarget({ shift: false, index: -1, count: 3, inside: false })).toBe("first");
    expect(tabTarget({ shift: true, index: -1, count: 3, inside: true, onHeading: true })).toBe("last");
    expect(tabTarget({ shift: false, index: -1, count: 0, inside: false })).toBeNull();
  });
});

describe("notice identity (SEQ-UI-05)", () => {
  it("a different message is a different notice, so a closed one comes back", () => {
    expect(noticeIdentity(undefined, ["error"], "Wrong code")).not.toBe(noticeIdentity(undefined, ["error"], "Code expired"));
    expect(noticeIdentity(undefined, ["error"], "Wrong code")).toBe(noticeIdentity(undefined, ["error"], "Wrong code"));
    expect(noticeIdentity("deleted:1", [], "x")).not.toBe(noticeIdentity("deleted:2", [], "x"));
  });
  it("reads plain text, numbers and lists; rich children count as empty", () => {
    expect(noticeText(["a", 3, null, { x: 1 }])).toBe("a3");
  });
});

describe("bill preview (SEQ-UI-03)", () => {
  it("INR 100 over 3: 10000 paise = 3334 + 3333 + 3333", () => {
    expect(billEachText("100", 3, "INR")).toBe("₹33.34 for one, ₹33.33 for the others");
  });
  it("divides evenly: 100 over 4 is ₹25 each", () => {
    expect(billEachText("100", 4, "INR")).toBe("₹25 each");
  });
  it("two leftover units: 1.01 over 3 = 34 + 34 + 33 paise (cents)", () => {
    expect(billEachText("1.01", 3, "INR")).toBe("₹0.34 for 2, ₹0.33 for the other");
  });
  it("uses the currency's decimals: JPY 1000 over 3 = 334, 333, 333; KWD 1.234 over 2 = 0.617 each", () => {
    expect(billEachText("1000", 3, "JPY")).toBe("JPY 334 for one, JPY 333 for the others");
    expect(billEachText("1.234", 2, "KWD")).toBe("KWD 0.617 each");
  });
  it("refuses more decimals than the currency has, and nothing to share with", () => {
    expect(billEachText("1.2345", 2, "KWD")).toBeNull();
    expect(billEachText("10.5", 2, "JPY")).toBeNull();
    expect(billEachText("", 2, "INR")).toBeNull();
    expect(billEachText("100", 1, "INR")).toBeNull();
  });
  it("shows the typed amount nicely", () => {
    expect(billAmountText("4,000", "INR")).toBe("₹4,000");
  });
});

describe("postcard message fit (SEQ-UI-07)", () => {
  it("how many lines fit: Caveat (1.12) 6, normal size 7", () => {
    // 0.73 * 2/3 = 0.48667 card widths of height; font 0.041 * size; line 1.28; one line for the sign-off + a 0.4 gap
    expect(maxMessageLines(1.12)).toBe(6);
    expect(maxMessageLines(1)).toBe(7);
  });
  it("10 short lines at size 1 are 3 too many", () => {
    const f = messageFit(Array(10).fill("hi").join("\n"), 1);
    expect(f).toEqual({ lines: 10, max: 7, over: 3 });
    expect(overText(3)).toBe("Too long for the card: trim about 3 lines.");
    expect(overText(1)).toBe("Too long for the card: trim about 1 line.");
  });
  it("a short note fits, and an empty one has no lines", () => {
    expect(messageFit("See you at the beach!", 1).over).toBe(0);
    expect(messageFit("   ", 1).lines).toBe(0);
  });
  it("a starter phrase never pushes the message past 500 characters", () => {
    expect(withOpener("x".repeat(MESSAGE_MAX), "Dear friend, ")).toHaveLength(MESSAGE_MAX);
    expect(withOpener("", "Hello")).toBe("Hello");
    expect(withOpener("Bye", "Hello ")).toBe("Hello Bye");
  });
});

describe("Show older / friends search (UISEQ-08)", () => {
  it("starts at 60, grows by 60, stops at 600", () => {
    expect(windowFor(undefined)).toEqual({ shown: 60, take: 61, next: 120 });
    expect(windowFor("200")).toEqual({ shown: 200, take: 201, next: 260 });
    expect(windowFor("99999")).toEqual({ shown: 600, take: 601, next: null });
    expect(windowFor("junk").shown).toBe(60);
  });
  it("trims the extra row and offers more only when it was there", () => {
    const w = windowFor(undefined);
    expect(trimWindow(Array(61).fill(1), w)).toEqual({ rows: Array(60).fill(1), more: 120 });
    expect(trimWindow(Array(10).fill(1), w).more).toBeNull();
  });
  it("friends: the first 80 show, but a name search looks through all 100", () => {
    const all = Array.from({ length: 100 }, (_, i) => ({ name: `Friend ${i}` }));
    expect(pickFriends(all, "", 80).shown).toHaveLength(80);
    const hit = pickFriends(all, "friend 95", 80);
    expect(hit.shown).toEqual([{ name: "Friend 95" }]);
    expect(hit.total).toBe(100);
    expect(pickFriends(all, "zzz", 80).matched).toBe(0);
  });
});

describe("chart labels (UISEQ-01, 02)", () => {
  it("money back is signed and says back; spending is untouched", () => {
    const money = (n: number) => formatMoney(n, "INR");
    expect(signedMoney(-3000, "INR")).toBe("−₹30");
    expect(backMoney(-3000, money)).toBe("−₹30 back");
    expect(backMoney(3000, money)).toBe("₹30");
  });
  it("no NaN%: dividing by nothing gives a dash", () => {
    expect(percentText(100, 0)).toBe("—");
    expect(percentText(100, -5)).toBe("—");
    expect(percentText(Number.NaN, 10)).toBe("—");
    expect(percentText(1, 4)).toBe("25%");
  });
  it("no bar at zero or below; small real money still shows", () => {
    expect(barSize(0, 100)).toBe(0);
    expect(barSize(-5, 100)).toBe(0);
    expect(barSize(1, 1000)).toBe(2);
    expect(barSize(500, 1000)).toBe(50);
  });
  it("the axis uses the currency's decimals: 1500 fils is KWD 1.5, 1500 yen is ¥1.5K", () => {
    expect(compactMoney(1500, "KWD")).toContain("1.5");
    expect(compactMoney(1500, "KWD")).not.toContain("15");
    expect(compactMoney(1500, "JPY")).toContain("1.5K");
  });
});

describe("Activity: Show more keeps every filter (UISEQ-03)", () => {
  it("keeps all nine filters and the longer length", () => {
    expect(activityMoreHref("g1", { q: "taxi", cat: "food", who: "m1", type: "payment", from: "2026-10-01", to: "2026-10-31", by: "m2", min: "10", max: "500" }, 180)).toBe(
      "/groups/g1?tab=activity&n=180&q=taxi&cat=food&who=m1&type=payment&from=2026-10-01&to=2026-10-31&by=m2&min=10&max=500",
    );
    expect(activityMoreHref("g1", {}, 180)).toBe("/groups/g1?tab=activity&n=180");
  });
});

describe("Yesterday across a clock change (INV-10)", () => {
  it("London, 30 March 2026 00:30 local (BST began the day before): the 29th is Yesterday", () => {
    // now = 29 Mar 23:30 UTC = 30 Mar 00:30 BST. Subtracting 24 h would land on the 28th and miss it.
    const now = new Date("2026-03-29T23:30:00Z");
    expect(dayLabel(new Date("2026-03-29T10:00:00Z"), now, "Europe/London")).toBe("Yesterday");
    expect(dayLabel(new Date("2026-03-30T00:10:00Z"), now, "Europe/London")).toBe("Today");
  });
});

describe("collection counts (UX-03)", () => {
  it("says what is known: 3 of 6 say they've paid, 2 checked", () => {
    expect(countsLine({ paidCount: 3, people: 6, checked: 2 })).toBe("3 of 6 say they've paid · 2 checked");
    expect(countsLine({ paidCount: 3, people: 6, checked: 0 })).toBe("3 of 6 say they've paid");
    expect(countsLine({ paidCount: 0, people: 6, checked: 0 })).toBe("No one has said they've paid yet");
  });
  it("the stamp counts only checked payments", () => {
    expect(stampCounts({ people: 6, checked: 2 })).toEqual({ n: 2, of: 6, word: "checked" });
    expect(stampCounts({ people: 0, checked: 0 }).of).toBeNull();
  });
});

describe("invite buttons say only what happened (SEQ-UI-10)", () => {
  it("WhatsApp and SMS only opened; email says it is sending", () => {
    expect(inviteLabel("whatsapp")).toBe("WhatsApp opened");
    expect(inviteLabel("sms")).toBe("SMS opened");
    expect(inviteLabel("email")).toBe("Sending the email…");
  });
});

describe("Record a payment starts from the top suggestion when you're owed", () => {
  const transfers = [
    { from: "r", to: "me", amount: 500 },
    { from: "s", to: "me", amount: 900 },
    { from: "me", to: "t", amount: 100 },
  ];
  it("owed 1400: the biggest payment to you (s pays 900)", () => {
    expect(defaultPayment(transfers, "me", 1400)).toEqual({ from: "s", to: "me", amount: 900 });
  });
  it("skips people who can't be picked (left)", () => {
    expect(defaultPayment(transfers, "me", 1400, (id) => id !== "s")).toEqual({ from: "r", to: "me", amount: 500 });
  });
  it("owing or square: nothing is guessed", () => {
    expect(defaultPayment(transfers, "me", -100)).toBeNull();
    expect(defaultPayment(transfers, "me", 0)).toBeNull();
  });
});

describe("move-out confirmation names the final payments", () => {
  const nameOf = (id: string) => (id === "me" ? "You" : "Ravi");
  const money = (n: number) => `₹${n / 100}`;
  it("lists them", () => {
    expect(moveOutConfirm({ leaverName: "Ravi", payments: [{ from: "me", to: "ravi", amount: 30000 }], nameOf, money })).toBe(
      "Final payments: You pay Ravi ₹300. They are recorded as paid and everyone is told. Mark Ravi as moved out?",
    );
    expect(moveOutConfirm({ leaverName: "Ravi", payments: [{ from: "ravi", to: "me", amount: 5000 }], nameOf, money })).toContain("Ravi pays you ₹50");
  });
  it("square", () => {
    expect(moveOutConfirm({ leaverName: "Ravi", payments: [], nameOf, money })).toBe("No payments are needed: Ravi is square. Mark Ravi as moved out?");
    expect(moveOutConfirm({ leaverName: "you", payments: [], nameOf, money })).toBe("No payments are needed: you are square. Mark yourself as moved out?");
  });
});

describe("small wording helpers", () => {
  it("Recap scope line", () => {
    expect(recapScope({ groupCount: 4, currency: "INR", converted: false })).toBe("All 4 groups · amounts in INR");
    expect(recapScope({ groupName: "Goa trip", groupCount: 1, currency: "THB", converted: true })).toBe("Goa trip · amounts in THB, others at the saved rate");
  });
  it("settings words follow the group type", () => {
    expect(closeHint("trip", false)).toMatch(/^Trip over\? Close it\./);
    expect(closeHint("home", false)).toMatch(/^Moved on from the flat\?/);
    expect(closeHint("pot", false)).toMatch(/^Game night over\?/);
    expect(closeHint("trip", true)).toBe("New expenses are paused. History is kept.");
    expect(sharesHint("couple")).toContain("Applies to new expenses");
  });
});

describe("'about' amounts round to a whole unit of the currency (forecast)", () => {
  it("INR 1,234.56 -> 1,235; JPY 1,250 stays; KWD 1,234.567 -> 1,235", () => {
    expect(roundToWhole(123456, "INR")).toBe(123500);
    expect(roundToWhole(1250, "JPY")).toBe(1250); // dividing by 100 would have given 1300
    expect(roundToWhole(1234567, "KWD")).toBe(1235000);
  });
});

describe("travel facts (SEQ-FEAT-07)", () => {
  const all = (o: Parameters<typeof storyLines>[0]) => storyLines({ ...o, n: 10 }).map(([k, l]) => `${k}: ${l}`).join(" | ");
  it("Bulgaria uses the euro", () => {
    const t = all({ country: "BG", countryName: "Bulgaria", flag: "", people: 4, seed: "x" });
    expect(t).toContain("euros");
    expect(t).not.toContain("lev");
  });
  it("Singapore, Bhutan and the Swiss pass say only what is true", () => {
    expect(all({ place: "place-singapore", people: 4, seed: "x" })).toContain("Gum's restricted");
    expect(all({ place: "place-singapore", people: 4, seed: "x" })).not.toContain("No chewing gum");
    expect(all({ place: "place-bhutan", people: 4, seed: "x" })).toContain("measures happiness, officially");
    expect(all({ place: "place-switzerland", people: 4, seed: "x" })).toContain("can pay for itself");
  });
  it("a solo traveller gets solo lines, not 'just you two'", () => {
    const t = all({ place: null, mood: "any", people: 1, seed: "s" });
    expect(t).toMatch(/Solo mode|Table for one/);
    expect(t).not.toMatch(/Just you two|Couple goals/);
  });
  it("Mussoorie maps to its own place, not Rishikesh", () => {
    expect(placeSlot("Mussoorie trip")).toBe("place-mussoorie");
    expect(placeSlot("Rishikesh rafting")).toBe("place-rishikesh");
  });
});

describe("activity filter chips", () => {
  const words = { cat: (id: string) => (id === "food" ? "Food" : id), person: (id: string) => (id === "a" ? "Asha" : "Ben") };
  it("no filters, no chips", () => {
    expect(filterChips("g1", {}, words)).toEqual([]);
  });
  it("one chip per filter; each link drops only that filter", () => {
    const f = { q: "pizza", cat: "food", who: "a", type: "expense" as const, by: "b" };
    const chips = filterChips("g1", f, words);
    expect(chips.map((c) => c.key)).toEqual(["q", "type", "cat", "who", "by"]);
    expect(chips.map((c) => c.label)).toEqual(["“pizza”", "Expenses", "Food", "Asha", "Paid by Ben"]);
    const q = chips.find((c) => c.key === "q")!;
    expect(q.href).toBe(activityHref("g1", { cat: "food", who: "a", type: "expense", by: "b" }));
    expect(q.href).not.toContain("q=");
    expect(q.href).toContain("cat=food");
  });
  it("dates and amounts are one chip each and clear together", () => {
    const chips = filterChips("g1", { from: "2026-10-01", to: "2026-10-31", min: "100", max: "500" }, words);
    expect(chips.map((c) => c.label)).toEqual(["1 Oct – 31 Oct", "100 – 500"]);
    expect(chips[0].href).toBe("/groups/g1?tab=activity&min=100&max=500");
    expect(chips[1].href).toBe("/groups/g1?tab=activity&from=2026-10-01&to=2026-10-31");
    expect(filterChips("g1", { from: "2026-10-01" }, words)[0].label).toBe("From 1 Oct");
    expect(filterChips("g1", { to: "2026-10-31" }, words)[0].label).toBe("Until 31 Oct");
    expect(filterChips("g1", { min: "100" }, words)[0].label).toBe("From 100");
    expect(filterChips("g1", { max: "500" }, words)[0].label).toBe("Up to 500");
  });
  it("a long search term is shortened", () => {
    expect(filterChips("g1", { q: "x".repeat(40) }, words)[0].label).toBe(`“${"x".repeat(24)}”`);
  });
});

describe("postcard opens line", () => {
  it("the same instant reads differently in each reader's zone", () => {
    const at = new Date("2026-12-31T18:30:00Z"); // 00:00 on 1 Jan 2027 in Asia/Kolkata
    expect(opensLine(at, "Asia/Kolkata")).toBe("Opens 1 January 2027 at 00:00 your time");
    expect(opensLine(at, "Europe/London")).toBe("Opens 31 December 2026 at 18:30 your time");
    expect(opensLine(at, "America/New_York")).toBe("Opens 31 December 2026 at 13:30 your time");
  });
  it("an unknown zone falls back to UTC", () => {
    expect(opensLine(new Date("2026-12-31T18:30:00Z"), "Not/AZone")).toBe("Opens 31 December 2026 at 18:30 your time");
  });
});
