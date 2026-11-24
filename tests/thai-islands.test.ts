import { describe, expect, it } from "vitest";
import { PHOTO_TAGS } from "@/lib/home/photo-tags";
import { STORY_POOLS, storyLines } from "@/lib/home/story-lines";

// Thai islands (look item 38, founder's pick 24 Nov): their own pictures, each looked at and tagged, and Thailand's own story lines.
describe("Thai islands", () => {
  it("every island picture is tagged, so story lines can match it (boats, a beach, cliffs, a sunset)", () => {
    expect(PHOTO_TAGS["place-thai-islands"]).toEqual(["boat", "island"]);
    for (const n of [2, 3, 4, 5, 6]) expect(PHOTO_TAGS[`place-thai-islands-${n}`]?.length).toBeGreaterThan(0);
    // No temple or city street among them: that was the problem.
    for (const n of ["", "-2", "-3", "-4", "-5", "-6"]) expect(PHOTO_TAGS[`place-thai-islands${n}`]).not.toContain("temple");
  });

  it("an island trip gets Thailand's own hand-written lines first (it is in Thailand), the same lines a Thailand trip gets", () => {
    const island = storyLines({ place: "place-thai-islands", country: "TH", people: 4, seed: "s" });
    const thailand = storyLines({ place: "place-thailand", country: "TH", people: 4, seed: "s" });
    expect(island).toEqual(thailand);
    expect(STORY_POOLS.PLACE.thailand.map((l) => l[1])).toContain(island[0][1]);
  });
});
