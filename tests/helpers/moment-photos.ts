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

