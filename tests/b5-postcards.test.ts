import { describe, expect, it } from "vitest";
import { opensLine, sealedDay } from "@/lib/postcards/opens";
import { stampSvg } from "@/lib/postcards/catalog";
import { cardProps } from "@/lib/postcards/view";

// B5 part A: sealed-card days (SA-2) and the year on the stamp (SB-8). Pure. Expected values are worked out by hand.

describe("SA-2: the day a sealed card opens", () => {
  // Priya in India seals for 1 Jan 2027: it opens at 00:00 India time = 18:30 UTC on 31 Dec 2026.
  const kolkata = new Date("2026-12-31T18:30:00Z");
  it("is the sender's day for the sender's zone, and the reader's clock in 'your time'", () => {
    expect(sealedDay(kolkata, "Asia/Kolkata", "Europe/London")).toBe("1 January 2027");
    expect(opensLine(kolkata, "Europe/London")).toBe("Opens 31 December 2026 at 18:30 your time");
  });
  it("a sender in Singapore (UTC+8): 00:00 on 1 Jan is 16:00 UTC on 31 Dec", () => {
    const singapore = new Date("2026-12-31T16:00:00Z");
    expect(sealedDay(singapore, "Asia/Singapore", "Asia/Kolkata")).toBe("1 January 2027");
  });
  it("falls back to the reader's zone when the sender's is unknown or not a real zone", () => {
    expect(sealedDay(kolkata, "", "Europe/London")).toBe("31 December 2026");
    expect(sealedDay(kolkata, "Not/AZone", "Europe/London")).toBe("31 December 2026");
    expect(sealedDay(kolkata, null, "Asia/Kolkata")).toBe("1 January 2027");
  });
  it("the short form for the shelf", () => {
    expect(sealedDay(kolkata, "Asia/Kolkata", "UTC", "short")).toBe("1 Jan");
  });
});

describe("SB-8: the stamp keeps the year the card was sent", () => {
  it("an explicit year is drawn", () => {
    expect(stampSvg("c:TH", "k", 2026)).toContain(">2026<");
    expect(stampSvg("c:TH", "k", 2025)).toContain(">2025<");
  });
  const row = { id: "p1", front: "own", photoId: "", words: "", lettering: "classic", message: "Hi", hand: "caveat", stamp: "c:TH", paper: "cream", address: "[]", place: "Goa", createdAt: new Date("2026-12-28T10:00:00Z") };
  it("cardProps gives the year of the postmark, in the same zone", () => {
    expect(cardProps(row, "Asha", "Asia/Kolkata").back.stampYear).toBe(2026); // 28 Dec 15:30 in India
  });
  it("at New Year the stamp and the postmark agree", () => {
    // 2026-12-31 20:00 UTC is 01:30 on 1 Jan 2027 in India, but still 31 Dec 2026 in London.
    const nye = { ...row, createdAt: new Date("2026-12-31T20:00:00Z") };
    const india = cardProps(nye, "Asha", "Asia/Kolkata");
    expect(india.back.stampYear).toBe(2027);
    expect(india.back.date).toContain("2027");
    const london = cardProps(nye, "Asha", "Europe/London");
    expect(london.back.stampYear).toBe(2026);
    expect(london.back.date).toContain("2026");
  });
});
