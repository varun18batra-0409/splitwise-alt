import { describe, expect, it, vi } from "vitest";

// Two downloaded photos stand in for the generated list: Manali, and "friends together" (the fallback).
vi.mock("../src/generated/photos.json", () => ({ default: { "place-manali": { src: "/p/manali.jpg" }, "cover-friends": { src: "/p/friends.jpg" } } }));

import { tripPhotoSrc } from "@/lib/places";

// A trip shows its place's real photo (polaroid, ticket stub, countdown thumb, group hero) whenever it has no photo of its own.
describe("which real photo a trip shows", () => {
  const trip = (o: Record<string, unknown> = {}) => ({ name: "Boys trip", type: "trip", cover: "", tripPlace: "Manali", ...o });

  it("the place comes from “Where to?” as well as the name: a trip called “Boys trip” to Manali gets Manali", () => {
    expect(tripPhotoSrc(trip())).toBe("/p/manali.jpg");
    expect(tripPhotoSrc(trip({ name: "Manali", tripPlace: "" }))).toBe("/p/manali.jpg");
  });

  it("a drawn picture stored on the group (the sunset beach) gives way to the photo when the place is known", () => {
    expect(tripPhotoSrc(trip({ cover: "beach" }))).toBe("/p/manali.jpg");
  });

  it("a drawn picture stays when the place is not known (nothing to show instead)", () => {
    expect(tripPhotoSrc(trip({ name: "Weekend", tripPlace: "", cover: "beach" }))).toBeUndefined();
  });

  it("no picture chosen and no known place: the friends photo, as before", () => {
    expect(tripPhotoSrc(trip({ name: "Weekend", tripPlace: "" }))).toBe("/p/friends.jpg");
  });

  it("a photo chosen on purpose, “plain”, and the group's own photo are left alone", () => {
    expect(tripPhotoSrc(trip({ cover: "photo-beach" }))).toBeUndefined();
    expect(tripPhotoSrc(trip({ cover: "plain" }))).toBeUndefined();
    expect(tripPhotoSrc(trip({ cover: "own", coverAt: new Date(1) }))).toBeUndefined();
    // "own" with no uploaded photo behind it is the default picture, so the place photo shows.
    expect(tripPhotoSrc(trip({ cover: "own", coverAt: null }))).toBe("/p/manali.jpg");
  });

  it("flats, couples and game nights keep their drawn art", () => {
    for (const type of ["home", "couple", "pot", "other"]) expect(tripPhotoSrc(trip({ type }))).toBeUndefined();
  });
});
