import { describe, expect, it } from "vitest";
import { parseDetails } from "@/lib/events";
import { memberMark, PHOTO_ONLY_MARK } from "@/lib/left-view";

// History lines carry marks for the code ("@mark:photo-only", "@mark:member=<id>"); only those exact forms are hidden.
describe("parseDetails hides only the exact marks", () => {
  it("a member named @mark:Bob keeps their share line; the real marks go", () => {
    const lines = ["Split: @mark:Bob ₹300", "@mark:Bob: ₹300", PHOTO_ONLY_MARK, memberMark("cm0abc"), "@mark:member=Bob Jones"];
    expect(parseDetails(JSON.stringify(lines))).toEqual(["Split: @mark:Bob ₹300", "@mark:Bob: ₹300", "@mark:member=Bob Jones"]);
  });
});
