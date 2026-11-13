// Photo fixtures built by hand: just enough of a JPEG or WebP for its size to be read and for the hidden-details check to accept it.
// Different `tag` = different bytes (so two photos can be told apart).
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export const jpeg = (w: number, h: number, tag = 0) =>
  new Uint8Array([
    0xff, 0xd8, // start
    0xff, 0xe0, 0x00, 0x10, ...ascii("JFIF"), 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // JFIF
    0xff, 0xc0, 0x00, 0x0b, 0x08, ...be16(h), ...be16(w), 0x01, 0x01, 0x11, 0x00, // SOF0: height then width
    0xff, 0xda, 0x00, 0x02, tag & 0x7f, (tag >> 7) & 0x7f, 0xff, 0xd9, // scan (the tag makes the bytes differ), end
  ]);

const riff = (chunks: number[]) => new Uint8Array([...ascii("RIFF"), ...le32(4 + chunks.length), ...ascii("WEBP"), ...chunks]);
const chunk = (id: string, payload: number[]) => [...ascii(id), ...le32(payload.length), ...payload, ...(payload.length & 1 ? [0] : [])];
// Lossy: 3-byte frame tag, start code 9d 01 2a, width and height (14 bits each).
export const webpLossy = (w: number, h: number) => riff(chunk("VP8 ", [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h), 0, 0, 0, 0]));
// Lossless: signature 2f, then width-1 (14 bits), height-1 (14 bits).
export const webpLossless = (w: number, h: number) => {
  const bits = (w - 1) | ((h - 1) << 14);
  return riff(chunk("VP8L", [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff, 0, 0, 0]));
};
// Extended: flags, then canvas width-1 and height-1 (24 bits each).
export const webpExtended = (w: number, h: number) => riff(chunk("VP8X", [0x10, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]));

// Extended with the animation flag set (0x02) and an animation chunk: a moving WebP.
export const webpAnimated = (w: number, h: number) =>
  riff([...chunk("VP8X", [0x12, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]), ...chunk("ANIM", [0, 0, 0, 0, 0, 0]), ...chunk("ANMF", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
// The same flag with no frames after it (a truncated one): still refused.
export const webpAnimatedFlagOnly = (w: number, h: number) => riff(chunk("VP8X", [0x12, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]));
// A JPEG with an Exif block holding a GPS location (APP1 "Exif", TIFF with a GPS IFD pointer and a few GPS bytes). `marker` is a
// distinctive byte string in the block, so a test can look for it in what was stored.
export const GPS_MARKER = "GPS-LAT-51.5007N";
export const jpegWithGps = (w: number, h: number, tag = 0) => {
  const base = jpeg(w, h, tag);
  const payload = [...ascii("Exif"), 0, 0, ...ascii("MM"), 0x00, 0x2a, 0, 0, 0, 8, 0x00, 0x01, 0x88, 0x25, 0x00, 0x04, 0, 0, 0, 1, 0, 0, 0, 0x1a, 0, 0, 0, 0, ...ascii(GPS_MARKER)];
  const app1 = [0xff, 0xe1, ...be16(payload.length + 2), ...payload];
  // After the start marker (2 bytes) and before the JFIF block.
  return new Uint8Array([...base.subarray(0, 2), ...app1, ...base.subarray(2)]);
};
