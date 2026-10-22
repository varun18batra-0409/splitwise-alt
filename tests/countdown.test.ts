import { describe, expect, it } from "vitest";
import { afterTripNudge, cleanTripDates, countdownNudge, countdownWords, placeOf, tripEmoji, tripPhase } from "@/lib/countdown";

describe("Trip countdown", () => {
  it("before, the day itself, during and after", () => {
    expect(tripPhase("2026-11-03", "2026-11-07", "2026-10-22")).toEqual({ kind: "before", days: 12 });
    expect(tripPhase("2026-11-03", "2026-11-07", "2026-11-02")).toEqual({ kind: "before", days: 1 });
    expect(tripPhase("2026-11-03", "2026-11-07", "2026-11-03")).toEqual({ kind: "today" });
    expect(tripPhase("2026-11-03", "2026-11-07", "2026-11-04")).toEqual({ kind: "during", day: 2, of: 5 });
    expect(tripPhase("2026-11-03", "2026-11-07", "2026-11-07")).toEqual({ kind: "during", day: 5, of: 5 });
    expect(tripPhase("2026-11-03", "2026-11-07", "2026-11-08")).toEqual({ kind: "after" });
    expect(tripPhase("2026-11-03", "", "2026-11-04")).toEqual({ kind: "after" }); // no end: a one-day trip
    expect(tripPhase("", "", "2026-11-04")).toBeNull();
  });

  it("counts across months and years, and leap days", () => {
    expect(tripPhase("2027-01-02", "", "2026-12-30")).toEqual({ kind: "before", days: 3 });
    expect(tripPhase("2028-03-01", "", "2028-02-28")).toEqual({ kind: "before", days: 2 });
  });

  it("the words get more excited as it gets close", () => {
    expect(countdownWords("Goa trip 2026", { kind: "before", days: 12 })!.line).toBe("Goa in 12 days 🌴");
    expect(countdownWords("Goa trip", { kind: "before", days: 5 })!.line).toBe("5 sleeps to Goa 🌴");
    expect(countdownWords("Goa trip", { kind: "before", days: 1 })!.line).toBe("Goa tomorrow 🌴");
    expect(countdownWords("Manali", { kind: "before", days: 70 })!.line).toBe("Manali in 10 weeks 🏔️");
    expect(countdownWords("Goa trip", { kind: "today" })!.line).toBe("It’s Goa day 🌴");
    expect(countdownWords("Goa trip", { kind: "during", day: 2, of: 5 })!.line).toBe("Day 2 of 5 in Goa 🌴");
    expect(countdownWords("Goa trip", { kind: "after" })).toBeNull();
  });

  it("the place and emoji come from the trip's name", () => {
    expect(placeOf("Goa trip 2026")).toBe("Goa");
    expect(placeOf("Ladakh road trip")).toBe("Ladakh");
    expect(placeOf("Weekend getaway")).toBe("Weekend getaway");
    expect(placeOf("Trip")).toBe("Trip");
    expect(tripEmoji("Spiti bike trip")).toBe("🏔️");
    expect(tripEmoji("Riya's wedding")).toBe("💍");
    expect(tripEmoji("Weekend away")).toBe("✈️");
  });

  it("nudges build up: 60, 45, 30, 14, 7, 3, 1 days before and on the day; same trip and step, same line", () => {
    const g = { id: "g1", name: "Goa trip" };
    for (const d of [60, 45, 30, 14, 7, 3, 1, 0]) expect(countdownNudge(g, d)).toContain("Goa");
    for (const d of [61, 59, 44, 29, 15, 8, 2, -1]) expect(countdownNudge(g, d)).toBeNull();
    expect(countdownNudge(g, 7)).toBe(countdownNudge(g, 7));
    // Different trips get different lines (not all the same message).
    const lines = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => countdownNudge({ id, name: "Goa trip" }, 30)));
    expect(lines.size).toBeGreaterThan(1);
    expect(afterTripNudge(g)).toContain("Goa");
  });

  it("checks typed dates", () => {
    expect(cleanTripDates("", "", "2026-10-22")).toEqual({ ok: true, start: "", end: "" });
    expect(cleanTripDates("2026-11-03", "2026-11-07", "2026-10-22")).toEqual({ ok: true, start: "2026-11-03", end: "2026-11-07" });
    expect(cleanTripDates("2026-11-03", "", "2026-10-22").ok).toBe(true);
    expect(cleanTripDates("2026-11-07", "2026-11-03", "2026-10-22").ok).toBe(false);
    expect(cleanTripDates("2026-02-30", "", "2026-01-01").ok).toBe(false);
    expect(cleanTripDates("", "2026-11-07", "2026-10-22").ok).toBe(false);
    expect(cleanTripDates("2026-11-01", "2027-02-01", "2026-10-22").ok).toBe(false);
    expect(cleanTripDates("2030-01-01", "", "2026-10-22").ok).toBe(false);
  });
});
