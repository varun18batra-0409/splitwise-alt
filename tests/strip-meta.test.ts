import { describe, expect, it } from "vitest";
import { cleanPhoto, stripImageMetadata } from "@/lib/strip-meta";
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
  // FR-L17: a photo whose structure can't be read isn't stored as it came.
  it("strict: a broken or unknown photo is refused, a clean one passes", () => {
    const picture = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9];
    const exif = seg(0xe1, txt("Exif\0\0GPS 12.97N 77.59E"));
    expect([...cleanPhoto(new Uint8Array([0xff, 0xd8, ...exif, ...picture]))!]).toEqual([0xff, 0xd8, ...picture]);
    // A segment that claims to run past the end of the file.
    expect(cleanPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, ...txt("GPS")]))).toBeNull();
    // No picture data at all.
    expect(cleanPhoto(new Uint8Array([0xff, 0xd8, ...exif]))).toBeNull();
    // Anything after the end of the picture (a "motion photo" video) is dropped.
    expect([...cleanPhoto(new Uint8Array([0xff, 0xd8, ...picture, ...txt("ftypmp4 GPS")]))!]).toEqual([0xff, 0xd8, ...picture]);
    // Not a JPEG, PNG or WebP.
    expect(cleanPhoto(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    // The lenient version still gives broken files back unchanged (and strict mode doesn't leak into it).
    expect([...stripImageMetadata(new Uint8Array([0xff, 0xd8, ...exif]))]).toEqual([0xff, 0xd8, ...exif]);
  });
  it("anything else comes back untouched", () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    expect([...stripImageMetadata(junk)]).toEqual([1, 2, 3, 4, 5]);
  });
});

// SEC-09: the WebP file's own size field decides where the picture ends.
// Hand-worked: "RIFF", size 16, "WEBP", "VP8L", chunk length 4, 4 bytes = 4 + 4 + 8 + 4 = 16 after the 8-byte RIFF header, 24 bytes in all.
describe("WebP: strict size checks", () => {
  const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
  const riff = (size: number, body: number[]) => [...txt("RIFF"), ...le32(size), ...txt("WEBP"), ...body];
  const vp8l = [...txt("VP8L"), ...le32(4), 0x2f, 0, 0, 0];
  const clean = riff(16, vp8l);

  it("the example file is 24 bytes and passes unchanged", () => {
    expect(clean.length).toBe(24);
    expect([...cleanPhoto(new Uint8Array(clean))!]).toEqual(clean);
  });
  it("bytes after the end of the RIFF are dropped (7-byte and 9-byte trailers), in both modes", () => {
    for (const trailer of ["GPS1234", "GPS123456"]) {
      const withTrailer = new Uint8Array([...clean, ...txt(trailer)]);
      expect([...cleanPhoto(withTrailer)!]).toEqual(clean);
      expect([...stripImageMetadata(withTrailer)]).toEqual(clean);
    }
    expect(clean.length + 7).toBe(31);
  });
  it("a RIFF size that runs past the file is refused", () => {
    expect(cleanPhoto(new Uint8Array(riff(100, vp8l)))).toBeNull();
  });
  it("a RIFF size that leaves stray bytes inside is refused (size 18, 2 stray bytes)", () => {
    expect(cleanPhoto(new Uint8Array([...riff(18, vp8l), 0x47, 0x50]))).toBeNull();
  });
  it("a chunk that runs past the RIFF end is refused", () => {
    const body = [...txt("VP8L"), ...le32(40), 0x2f, 0, 0, 0];
    expect(cleanPhoto(new Uint8Array(riff(16, body)))).toBeNull();
  });
  it("an odd-length chunk with its pad byte still passes", () => {
    // VP8L with 5 data bytes + 1 pad: 4 + (8 + 5 + 1) = 18.
    const odd = riff(18, [...txt("VP8L"), ...le32(5), 0x2f, 0, 0, 0, 1, 0]);
    expect(odd.length).toBe(26);
    expect([...cleanPhoto(new Uint8Array(odd))!]).toEqual(odd);
  });
  it("Exif and XMP chunks are removed and the size field is rebuilt (valid)", () => {
    const exif = [...txt("EXIF"), ...le32(4), ...txt("GPS!")];
    const withExif = riff(4 + 12 + 12, [...vp8l, ...exif]);
    const out = cleanPhoto(new Uint8Array(withExif))!;
    expect([...out]).toEqual(clean);
  });
  it("the lenient version gives a broken WebP back unchanged", () => {
    const broken = new Uint8Array(riff(100, vp8l));
    expect([...stripImageMetadata(broken)]).toEqual([...broken]);
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
