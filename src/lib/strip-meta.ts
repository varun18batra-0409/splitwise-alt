// Removes hidden details from uploaded photos before they're stored: camera
// data, the place it was taken (GPS) and editing notes. Only the picture is
// kept. Works on JPEG, PNG and WebP without re-encoding; anything it doesn't
// understand is returned unchanged (the app's own uploads are already
// re-drawn on the phone, which drops these too).

export function stripImageMetadata(input: Uint8Array): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(new ArrayBuffer(input.length));
  b.set(input);
  try {
    if (b[0] === 0xff && b[1] === 0xd8) return stripJpeg(b);
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return stripPng(b);
    if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return stripWebp(b);
  } catch {
    // Not what it claimed to be: leave it alone (type checks happen elsewhere).
  }
  return b;
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((t, p) => t + p.length, 0)));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// JPEG: drop APP1 (Exif / XMP), APP12, APP13 (IPTC) and comments. Keep JFIF (APP0) and colour profiles (APP2).
function stripJpeg(b: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return b; // not a clean segment list: leave as is
    const marker = b[i + 1];
    if (marker === 0xda) {
      parts.push(b.subarray(i)); // start of the picture data: everything from here is kept
      return concat(parts);
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return b;
    const drop = marker === 0xe1 || marker === 0xec || marker === 0xed || marker === 0xfe || (marker >= 0xe3 && marker <= 0xef);
    if (!drop) parts.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return b;
}

// PNG: drop text and Exif chunks (tEXt, zTXt, iTXt, eXIf, tIME).
function stripPng(b: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  const drop = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length) return b;
    if (!drop.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") return concat(parts);
  }
  return b;
}

// WebP: drop EXIF and XMP chunks and clear their flags.
function stripWebp(b: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  let i = 12;
  let removed = false;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const len = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
    const end = i + 8 + len + (len & 1);
    if (len < 0 || end > b.length) return b;
    if (type === "EXIF" || type === "XMP ") removed = true;
    else if (type === "VP8X") {
      const c = new Uint8Array(b.subarray(i, end));
      c[8] &= ~(0x08 | 0x04); // the "has Exif" and "has XMP" flags
      parts.push(c);
    } else parts.push(b.subarray(i, end));
    i = end;
  }
  if (!removed) return b;
  const body = concat(parts);
  const size = body.length + 4;
  const head = new Uint8Array([0x52, 0x49, 0x46, 0x46, size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff, 0x57, 0x45, 0x42, 0x50]);
  return concat([head, body]);
}
