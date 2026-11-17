import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/generated/photos.json", () => ({
  default: { "place-manali": { src: "/p/manali.jpg" }, "cover-friends": { src: "/p/friends.jpg" }, "cover-paris": { src: "/p/paris.jpg" } },
}));
let ownRow: { data: Uint8Array; type: string; blobKey: string } | null = null;
vi.mock("@/lib/db", () => ({ db: { groupPhoto: { findUnique: async () => ownRow } } }));

import { photoData } from "@/lib/share-photo";

// Each picture's bytes are its own name, so the answer says which picture was chosen.
const body = (src: string) => Buffer.from(src);
const asText = (d: string | null) => (d ? Buffer.from(d.split(",")[1], "base64").toString() : null);

function fakeFetch(types: Record<string, string> = {}) {
  vi.stubGlobal("fetch", async (u: URL) => {
    const path = new URL(u).pathname;
    return new Response(body(path), { status: 200, headers: { "content-type": types[path] ?? "image/jpeg" } });
  });
}
afterEach(() => {
  ownRow = null;
  vi.unstubAllGlobals();
});

const g = (o: Record<string, unknown> = {}) => ({ id: "g1", name: "Boys trip", cover: "", type: "trip", coverAt: null as Date | null, tripPlace: "Manali", ...o });

describe("B5 which picture share images use (SB-7, SA-12)", () => {
  it("a trip with the default cover uses the place typed in Where to?", async () => {
    fakeFetch();
    expect(asText(await photoData(g(), "https://x.test"))).toBe("/p/manali.jpg");
  });
  it("the group's own JPEG photo comes first", async () => {
    fakeFetch();
    ownRow = { data: new Uint8Array([79, 87, 78]), type: "image/jpeg", blobKey: "" };
    expect(asText(await photoData(g({ cover: "own", coverAt: new Date(1) }), "https://x.test"))).toBe("OWN");
  });
  it("a picked photo cover (Paris) is used", async () => {
    fakeFetch();
    expect(asText(await photoData(g({ cover: "photo-paris" }), "https://x.test"))).toBe("/p/paris.jpg");
  });
  it("nothing set and no known place: the friends/mood photo", async () => {
    fakeFetch();
    expect(asText(await photoData(g({ name: "Weekend", tripPlace: "" }), "https://x.test"))).toBe("/p/friends.jpg");
  });
  it("an older WebP group photo is not drawn: the last choice (a photo for the name and place) takes over", async () => {
    fakeFetch();
    ownRow = { data: new Uint8Array([1, 2, 3]), type: "image/webp", blobKey: "" };
    expect(asText(await photoData(g({ cover: "own", coverAt: new Date(1) }), "https://x.test"))).toBe("/p/manali.jpg");
  });
  it("a picture that comes back as WebP is refused", async () => {
    fakeFetch({ "/p/manali.jpg": "image/webp" });
    expect(await photoData(g(), "https://x.test")).toBeNull();
  });
});
