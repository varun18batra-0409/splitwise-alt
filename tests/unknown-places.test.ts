import { describe, expect, it } from "vitest";
import { noteTripPlace, noteTripPlaceLater, normalisePlace, placesToRecord, placeTag, type PlaceStore } from "../src/lib/unknown-places";

// Pure parts only (no database): what is kept, what is skipped, and that a failure never reaches the save.

describe("normalisePlace", () => {
  it("keeps a plain place, lowercased, trimmed, spaces collapsed", () => {
    expect(normalisePlace("  Lisbon ")).toBe("lisbon");
    expect(normalisePlace("Cape   Town")).toBe("cape town");
    expect(normalisePlace("Aix-en-Provence")).toBe("aix-en-provence");
    expect(normalisePlace("São Paulo")).toBe("são paulo");
    expect(normalisePlace("Hell’s Gate")).toBeNull(); // possessive: could be a person
    expect(normalisePlace("Ao Nang")).toBe("ao nang");
    expect(normalisePlace("Oz")).toBeNull(); // one word under 3 letters
  });
  it("accepts 2-word-or-more names and apostrophes that are not possessive", () => {
    expect(normalisePlace("L'Aquila")).toBe("l'aquila");
    expect(normalisePlace("Ho Chi")).toBe("ho chi");
  });
  it("skips digits, symbols, emails, links and phones", () => {
    for (const bad of ["Room 12", "a@b.com", "https://x.co", "+91 98765 43210", "Lisbon!", "Lisbon, Porto", "Lisbon_1", "", "   ", "a"]) expect(normalisePlace(bad), bad).toBeNull();
  });
  it("skips too long and too many words", () => {
    expect(normalisePlace("a".repeat(41))).toBeNull();
    expect(normalisePlace("a".repeat(40))).toBe("a".repeat(40));
    expect(normalisePlace("one two three four five")).toBeNull();
  });
  it("skips things that look personal or about the group", () => {
    for (const bad of ["Rohan's bachelor party", "Rohan's farmhouse", "Goa trip with the boys", "our home", "Priya birthday", "Family reunion", "My flat"]) expect(normalisePlace(bad), bad).toBeNull();
  });
});

describe("placesToRecord (a place Loopin has no photo for)", () => {
  it("does not record a place Loopin knows", () => {
    expect(placesToRecord("goa", "")).toEqual([]);
    expect(placesToRecord("Tokyo", "JP")).toEqual([]);
    expect(placesToRecord("Bangkok, Phuket", "")).toEqual([]);
    expect(placesToRecord("Lisbon", "FR")).toEqual([]); // the country has a photo
  });
  it("records an unknown place, and its country", () => {
    expect(placesToRecord("lisbon", "")).toEqual(["lisbon"]);
    expect(placesToRecord("Lisbon", "PT")).toEqual(["lisbon", "portugal"]);
    expect(placesToRecord("", "PT")).toEqual(["portugal"]);
  });
  it("splits a list of places and skips the pieces that are not places", () => {
    expect(placesToRecord("Lisbon, Porto & Faro", "")).toEqual(["lisbon", "porto", "faro"]);
    expect(placesToRecord("Lisbon, Rohan's farmhouse", "")).toEqual(["lisbon"]);
  });
  it("records nothing for empty input", () => {
    expect(placesToRecord("", "")).toEqual([]);
    expect(placesToRecord(null, undefined)).toEqual([]);
  });
});

describe("placeTag", () => {
  it("is stable, keyed, and does not contain the trip id", () => {
    const t = placeTag("s1", "group-abc123", "lisbon");
    expect(t).toBe(placeTag("s1", "group-abc123", "lisbon"));
    expect(t).not.toBe(placeTag("s2", "group-abc123", "lisbon"));
    expect(t).not.toBe(placeTag("s1", "group-other", "lisbon"));
    expect(t).not.toBe(placeTag("s1", "group-abc123", "porto"));
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(t).not.toContain("abc123");
  });
});

function fake() {
  const calls: [string, string][] = [];
  const store: PlaceStore = { note: async (place, tag) => void calls.push([place, tag]) };
  return { calls, store };
}

describe("noteTripPlace", () => {
  it("hands only the place and a hash to the store; a known place is not stored", async () => {
    const a = fake();
    await noteTripPlace("group-xyz789", "Lisbon", "", { store: a.store, secret: "s" });
    expect(a.calls).toEqual([["lisbon", placeTag("s", "group-xyz789", "lisbon")]]);
    expect(JSON.stringify(a.calls)).not.toContain("xyz789");
    const b = fake();
    await noteTripPlace("g", "goa", "", { store: b.store, secret: "s" });
    await noteTripPlace("g", "Bangkok, Phuket", "", { store: b.store, secret: "s" });
    expect(b.calls).toEqual([]);
  });
  it("records nothing without the secret", async () => {
    const a = fake();
    const was = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    await noteTripPlace("g", "Lisbon", "", { store: a.store });
    if (was !== undefined) process.env.AUTH_SECRET = was;
    expect(a.calls).toEqual([]);
  });
  it("never throws when the store fails", async () => {
    const bad: PlaceStore = { note: async () => { throw new Error("database is down"); } };
    await expect(noteTripPlace("g", "Lisbon", "PT", { store: bad, secret: "s" })).resolves.toBeUndefined();
  });
});

describe("noteTripPlaceLater (the save path)", () => {
  it("never throws when scheduling fails, or when the job fails", async () => {
    expect(() => noteTripPlaceLater(() => { throw new Error("not in a request"); }, "g", "Lisbon", "")).not.toThrow();
    const bad: PlaceStore = { note: async () => { throw new Error("boom"); } };
    let job: (() => Promise<void>) | undefined;
    noteTripPlaceLater((j) => { job = j; }, "g", "Lisbon", "", { store: bad, secret: "s" });
    await expect(job!()).resolves.toBeUndefined();
  });
  it("runs the work later, not at once", () => {
    const a = fake();
    noteTripPlaceLater(() => undefined, "g", "Lisbon", "", { store: a.store, secret: "s" });
    expect(a.calls).toEqual([]);
  });
});
