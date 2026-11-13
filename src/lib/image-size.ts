// How big a JPEG or WebP is, read from its header (no decoding). Used to check that a moment's photo is the size the phone
// was asked to make (so a huge picture can't be stored). Rubbish or an unknown kind gives null.

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

export type ImageSize = { width: number; height: number };

function jpegSize(b: Uint8Array): ImageSize | null {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) {
      i += 1; // padding
      continue;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    if (m === 0xd9 || m === 0xda) return null; // the picture data starts before any size was found
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    const sof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (sof) {
      if (i + 9 > b.length) return null;
      const height = u16be(b, i + 5);
      const width = u16be(b, i + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + len;
  }
  return null;
}

function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 25) return null;
  const kind = ascii(b, 12, 4);
  let width = 0;
  let height = 0;
  if (kind === "VP8 ") {
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    width = u16le(b, 26) & 0x3fff;
    height = u16le(b, 28) & 0x3fff;
  } else if (kind === "VP8L") {
    if (b[20] !== 0x2f) return null;
    width = 1 + (b[21] | ((b[22] & 0x3f) << 8));
    height = 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10));
  } else if (kind === "VP8X") {
    if (b.length < 30) return null;
    width = 1 + u24le(b, 24);
    height = 1 + u24le(b, 27);
  } else return null;
  return width > 0 && height > 0 ? { width, height } : null;
}

export function imageSize(b: Uint8Array): ImageSize | null {
  try {
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
    if (b.length > 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return webpSize(b);
  } catch {
    /* unreadable: null below */
  }
  return null;
}
