import { describe, expect, it } from "vitest";
import { imageSize } from "@/lib/image-size";

import { jpeg, webpExtended, webpLossless, webpLossy } from "./helpers/moment-photos";

describe("reading a photo's size from its header", () => {
  it("JPEG: width and height are the right way round", () => {
    expect(imageSize(jpeg(1600, 1200))).toEqual({ width: 1600, height: 1200 });
    expect(imageSize(jpeg(480, 640))).toEqual({ width: 480, height: 640 });
  });
  it("JPEG: skips other segments before the size, and a picture with no size gives null", () => {
    const noSize = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x11, 0xff, 0xd9]);
    expect(imageSize(noSize)).toBeNull();
  });
  it("WebP lossy", () => {
    expect(imageSize(webpLossy(1600, 900))).toEqual({ width: 1600, height: 900 });
    expect(imageSize(webpLossy(480, 360))).toEqual({ width: 480, height: 360 });
  });
  it("WebP lossless", () => {
    expect(imageSize(webpLossless(1280, 720))).toEqual({ width: 1280, height: 720 });
    expect(imageSize(webpLossless(401, 3))).toEqual({ width: 401, height: 3 });
  });
  it("WebP extended", () => {
    expect(imageSize(webpExtended(1600, 1067))).toEqual({ width: 1600, height: 1067 });
    expect(imageSize(webpExtended(4000, 3000))).toEqual({ width: 4000, height: 3000 });
  });
  it("a full photo's long side must be 1600 or less: 1601 is over, 1600 is not (the upload route compares this)", () => {
    const long = (b: Uint8Array) => Math.max(imageSize(b)!.width, imageSize(b)!.height);
    expect(long(jpeg(1601, 800))).toBe(1601);
    expect(long(jpeg(1601, 800)) > 1600).toBe(true);
    expect(long(webpLossy(800, 1600)) > 1600).toBe(false);
    expect(long(jpeg(481, 300)) > 480).toBe(true);
  });
  it("rubbish, empty and cut-off bytes give null", () => {
    expect(imageSize(new Uint8Array())).toBeNull();
    expect(imageSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]))).toBeNull();
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(imageSize(webpLossy(100, 100).subarray(0, 20))).toBeNull();
    expect(imageSize(new TextEncoder().encode("<html>not a photo at all, just words</html>"))).toBeNull();
  });
  it("a PNG is not a kind of photo the moments take", () => {
    expect(imageSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii("IHDR"), 0, 0, 1, 0, 0, 0, 1, 0]))).toBeNull();
  });
});
