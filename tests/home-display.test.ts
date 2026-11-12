import { describe, expect, it } from "vitest";
import { collectSentence, homeMoney, paidAction, paidToViewer, storyShort } from "@/lib/home/display";
import { buildStories } from "@/lib/home/stories";
import { formatMoney } from "@/lib/money";

// Home's display-only helpers. Rounding here never touches a stored value: the same minor units still format exactly elsewhere.

describe("homeMoney: whole units for big amounts, display only", () => {
  it("INR 68,263.10 (6826310 paise) shows ₹68,263", () => {
    expect(homeMoney(6826310, "INR")).toBe("₹68,263");
  });
  it("INR 47,974.91 (4797491 paise) rounds up to ₹47,975", () => {
    expect(homeMoney(4797491, "INR")).toBe("₹47,975");
  });
  it("INR 1,000.49 rounds down to ₹1,000; 1,000.50 up to ₹1,001; lakh style is kept", () => {
    expect(homeMoney(100049, "INR")).toBe("₹1,000");
    expect(homeMoney(100050, "INR")).toBe("₹1,001");
    expect(homeMoney(12345678, "INR")).toBe("₹1,23,457"); // ₹1,23,456.78
  });
  it("under ₹1,000 the exact amount stays: ₹999.99, ₹393.34, ₹250", () => {
    expect(homeMoney(99999, "INR")).toBe("₹999.99");
    expect(homeMoney(39334, "INR")).toBe("₹393.34");
    expect(homeMoney(25000, "INR")).toBe("₹250");
  });
  it("USD keeps cents under $1,000 and drops them from $1,000: 48.50 stays, 1,234.56 -> $1,235", () => {
    expect(homeMoney(4850, "USD")).toBe("$48.50");
    expect(homeMoney(123456, "USD")).toBe("$1,235");
  });
  it("EUR 2,500.40 -> EUR 2,500; yen (no decimals) is untouched", () => {
    expect(homeMoney(250040, "EUR")).toBe("EUR 2,500");
    expect(homeMoney(1234567, "JPY")).toBe("JPY 1,234,567");
  });
  it("works on the size only: the exact formatter still shows the paise", () => {
    expect(formatMoney(6826310, "INR")).toBe("₹68,263.10");
  });
});

describe("Needs you wording for collections", () => {
  const mine = { upiId: "Asha@okicici", payLink: "" };
  it("money to the viewer's own UPI ID (any capital letters): 'paid you' and Confirm", () => {
    expect(paidToViewer({ currency: "INR", upiId: "asha@okicici", payLink: "" }, mine)).toBe(true);
    expect(collectSentence("Meera", "₹300", "Teacher’s Day gift", true)).toBe("Meera says they paid you ₹300");
    expect(paidAction(true)).toBe("Confirm");
  });
  it("money to someone else's UPI ID (a treasurer): neutral, names the collection, and the action is View", () => {
    expect(paidToViewer({ currency: "INR", upiId: "treasurer@ybl", payLink: "" }, mine)).toBe(false);
    expect(collectSentence("Meera", "₹300", "Teacher’s Day gift", false)).toBe("Meera says they paid ₹300 for Teacher’s Day gift");
    expect(paidAction(false)).toBe("View");
  });
  it("other currencies compare the pay link; no pay details, or no saved ones on the account, stay neutral", () => {
    expect(paidToViewer({ currency: "USD", upiId: "", payLink: "https://paypal.me/asha" }, { upiId: "", payLink: "https://paypal.me/asha" })).toBe(true);
    expect(paidToViewer({ currency: "USD", upiId: "", payLink: "https://paypal.me/other" }, { upiId: "", payLink: "https://paypal.me/asha" })).toBe(false);
    expect(paidToViewer({ currency: "INR", upiId: "", payLink: "" }, mine)).toBe(false);
    expect(paidToViewer({ currency: "INR", upiId: "asha@okicici", payLink: "" }, { upiId: "", payLink: "" })).toBe(false);
    expect(paidToViewer({ currency: "INR", upiId: "asha@okicici", payLink: "" }, null)).toBe(false);
  });
  it("both wordings start '<name> says they paid', which is what Activity matches to hide the duplicate", () => {
    for (const s of [collectSentence("Zoya", "₹200", "Trip", true), collectSentence("Zoya", "₹200", "Trip", false)]) expect(s.startsWith("Zoya says they paid")).toBe(true);
  });
});

describe("story labels", () => {
  it("up to 10 characters stay whole; longer ones are cut to 9 plus an ellipsis", () => {
    expect(storyShort("Collection")).toBe("Collection");
    expect(storyShort("Card night")).toBe("Card night");
    expect(storyShort("Lonavala weekend")).toBe("Lonavala…");
    expect(storyShort("Teacher’s Day gift")).toBe("Teacher’s…");
  });
  it("each story kind has a short, descriptive label", () => {
    const stories = buildStories({
      now: new Date("2026-11-12T10:00:00Z"),
      trips: [],
      games: [{ id: "g1", groupId: "gr", name: "Friday rummy", winner: "Asha", won: "₹500", finishedAt: new Date("2026-11-12T08:00:00Z") }],
      squared: [{ id: "s1", name: "Flat 402", at: new Date("2026-11-12T08:00:00Z") }],
      collections: [{ id: "c1", code: "abc", title: "Teacher’s Day gift", paid: 1, people: 3 }],
      memories: [{ id: "m1", name: "Goa trip", years: 1, people: 4, days: 3 }],
      wrapped: [{ id: "w1", name: "Thailand trip", endedDaysAgo: 2 }],
    });
    const shortOf = (k: string) => stories.find((s) => s.kind === k)?.short;
    expect(shortOf("pot")).toBe("Card night");
    expect(shortOf("square")).toBe("All square");
    expect(shortOf("collect")).toBe("Collection");
    expect(shortOf("memory")).toBe("A year ago");
    expect(shortOf("wrapped")).toBe("Wrapped");
    expect(stories.find((s) => s.kind === "collect")?.label).toBe("Teacher’s Day…"); // the full-ish label is unchanged
  });
});
