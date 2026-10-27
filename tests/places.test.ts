import { describe, expect, it } from "vitest";
import { placeSlot } from "@/lib/places";

// The countdown shows the destination: the trip's name picks the place.
describe("Trip countdown: the destination's photo", () => {
  it("finds the place in the trip's name", () => {
    expect(placeSlot("Thailand Trip")).toBe("place-thailand");
    expect(placeSlot("Phuket 2026")).toBe("place-thailand");
    expect(placeSlot("Goa trip")).toBe("place-goa");
    expect(placeSlot("Leh Ladakh bike trip")).toBe("place-ladakh");
    expect(placeSlot("Spiti road trip")).toBe("place-ladakh");
    expect(placeSlot("Munnar & Alleppey")).toBe("place-kerala");
    expect(placeSlot("Sri Lanka with the gang")).toBe("place-srilanka");
    expect(placeSlot("NYC")).toBe("place-newyork");
    expect(placeSlot("Paris honeymoon")).toBe("cover-paris");
    expect(placeSlot("Agra day trip")).toBe("cover-taj");
    // Indian weekends get their own place, not a stranger's road.
    expect(placeSlot("Weekend in Pune")).toBe("place-pune");
    expect(placeSlot("Lonavala weekend")).toBe("place-lonavala");
    expect(placeSlot("Mumbai darshan")).toBe("place-mumbai");
    expect(placeSlot("Udaipur wedding")).toBe("place-udaipur");
    expect(placeSlot("Pondy break")).toBe("place-pondicherry");
  });
  it("doesn't match inside other words", () => {
    expect(placeSlot("Goal party")).toBeNull(); // not Goa
    expect(placeSlot("Lehenga shopping")).toBeNull(); // not Leh
    expect(placeSlot("Bellary")).toBeNull(); // not Ella
    expect(placeSlot("Weekend away")).toBeNull();
    expect(placeSlot("Brann party")).toBeNull(); // not Rann
    expect(placeSlot("Kashish birthday")).toBeNull(); // not Kashi
  });
});
