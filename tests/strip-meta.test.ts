import { describe, expect, it } from "vitest";
import { stripImageMetadata } from "@/lib/strip-meta";
import { pickAdmin } from "@/lib/group-admin";

const seg = (marker: number, payload: number[]) => [0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload];
const txt = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe("photos lose their hidden details before they're stored", () => {
  it("JPEG: the Exif block (camera, GPS) goes, the picture stays byte for byte", () => {
    const app0 = seg(0xe0, txt("JFIF\0\x01\x01"));
    const exif = seg(0xe1, txt("Exif\0\0GPS 12.97N 77.59E"));
    const comment = seg(0xfe, txt("taken at home"));
    const picture = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9];
    const out = stripImageMetadata(new Uint8Array([0xff, 0xd8, ...app0, ...exif, ...comment, ...picture]));
    expect([...out]).toEqual([0xff, 0xd8, ...app0, ...picture]);
    expect(String.fromCharCode(...out)).not.toContain("GPS");
  });
  it("PNG: text and Exif chunks go", () => {
    const chunk = (type: string, data: number[]) => [0, 0, 0, data.length, ...txt(type), ...data, 0, 0, 0, 0];
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const ihdr = chunk("IHDR", Array(13).fill(1));
    const idat = chunk("IDAT", [1, 2, 3]);
    const out = stripImageMetadata(new Uint8Array([...sig, ...ihdr, ...chunk("eXIf", txt("GPS")), ...chunk("tEXt", txt("Author")), ...idat, ...chunk("IEND", [])]));
    expect([...out]).toEqual([...sig, ...ihdr, ...idat, ...chunk("IEND", [])]);
  });
  it("anything else comes back untouched", () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    expect([...stripImageMetadata(junk)]).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("who looks after a group", () => {
  const d = new Date();
  it("is the person who started it", () => {
    expect(pickAdmin([{ id: "a", claimedAt: d, leftAt: null }, { id: "b", claimedAt: d, leftAt: null }])?.id).toBe("a");
  });
  it("names added by hand (never joined) don't count, and if the starter left the next person takes over", () => {
    expect(pickAdmin([{ id: "ravi", claimedAt: null, leftAt: null }, { id: "me", claimedAt: d, leftAt: null }])?.id).toBe("me");
    expect(pickAdmin([{ id: "a", claimedAt: d, leftAt: d }, { id: "b", claimedAt: d, leftAt: null }])?.id).toBe("b");
  });
});
