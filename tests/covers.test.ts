import { describe, expect, it } from "vitest";
import { COVERS, cleanCover, coverFor, coverOf, isCoverChoice, photoType } from "@/lib/covers";

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
  it("a photo that couldn't be downloaded shows its drawn look-alike", () => {
    // (no photos are downloaded when the tests run)
    expect(coverOf({ type: "trip", cover: "photo-road" })).toBe("mountain");
    expect(coverOf({ type: "home", cover: "photo-home" })).toBe("city");
    expect(COVERS.some((c) => c.id.startsWith("photo-"))).toBe(false);
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

describe("a group's own photo", () => {
  const at = new Date("2026-10-21T06:00:00Z");
  it("shows only when the group really has one, and never to someone not in the group", () => {
    expect(coverFor({ id: "g1", type: "trip", cover: "own", coverAt: at })).toEqual({ kind: "own", src: `/api/group-photo/g1?v=${at.getTime()}` });
    expect(coverFor({ id: "g1", type: "trip", cover: "own", coverAt: null })).toEqual({ kind: "beach" });
    expect(coverFor({ id: "g1", type: "trip", cover: "own", coverAt: at }, true)).toEqual({ kind: "beach" });
    expect(cleanCover("own", "trip", false)).toBe("");
    expect(cleanCover("own", "trip", true)).toBe("own");
  });
  it("accepts JPEG, PNG and WebP by their bytes, nothing else", () => {
    expect(photoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("image/jpeg");
    expect(photoType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(photoType(new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe("image/webp");
    expect(photoType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(photoType(new TextEncoder().encode("GIF89a........"))).toBeNull();
  });
});
