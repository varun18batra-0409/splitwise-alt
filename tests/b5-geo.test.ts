import { describe, expect, it } from "vitest";
import { tripStops } from "@/lib/geo";

// B12: "Georgia" the US state versus the country.
describe("B5 Georgia", () => {
  it("Atlanta and Savannah are the US, even with 'Georgia' after them", () => {
    expect(tripStops("Atlanta, Georgia")).toEqual([{ city: "Atlanta", country: "US" }]);
    expect(tripStops("Savannah, Georgia")).toEqual([{ city: "Savannah", country: "US" }]);
  });
  it("Georgia, USA is the US", () => {
    expect(tripStops("Georgia, USA")).toEqual([{ city: "", country: "US" }]);
  });
  it("Tbilisi and Batumi are the country", () => {
    expect(tripStops("Tbilisi")).toEqual([{ city: "", country: "GE" }]);
    expect(tripStops("Batumi")).toEqual([{ city: "", country: "GE" }]);
  });
  it("'Georgia trip' stays the country (still ambiguous, by design)", () => {
    expect(tripStops("Georgia trip")).toEqual([{ city: "", country: "GE" }]);
  });
});
