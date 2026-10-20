import { describe, expect, it } from "vitest";
import { cleanCover, coverOf, isCoverChoice } from "@/lib/covers";

// A group's picture: its own choice, else one that suits its type.
describe("group pictures", () => {
  it("follows the type until one is picked", () => {
    expect(coverOf({ type: "trip", cover: "" })).toBe("beach");
    expect(coverOf({ type: "home", cover: "" })).toBe("city");
    expect(coverOf({ type: "couple", cover: null })).toBe("couple");
    expect(coverOf({ type: "other" })).toBe("dinner");
    expect(coverOf({ type: "trip", cover: "mountain" })).toBe("mountain");
    expect(coverOf({ type: "trip", cover: "plain" })).toBe("plain");
  });
  it("ignores anything that isn't one of the pictures", () => {
    expect(isCoverChoice("https://evil.example/x.png")).toBe(false);
    expect(coverOf({ type: "home", cover: "<script>" })).toBe("city");
    expect(cleanCover("<script>", "trip")).toBe("");
  });
  it("stores nothing when the pick is the type's own picture, so changing the type still changes it", () => {
    expect(cleanCover("beach", "trip")).toBe("");
    expect(cleanCover("diwali", "other")).toBe("diwali");
    expect(cleanCover("plain", "home")).toBe("plain");
  });
});
