// The shape of a postcard: front and back ("classic") or a single side ("oneside"), how a photo sits on the front,
// and how big the taped print is on a one-side card. Pure, so the phone and the server use the same rules.
// Anything unknown (an older card, a made-up value) is read as the original: classic, full, small.

export const FORMATS = ["classic", "oneside"] as const;
export const FITS = ["full", "border", "taped"] as const;
export const PHOTO_SIZES = ["small", "medium", "large"] as const;
export type Format = (typeof FORMATS)[number];
export type Fit = (typeof FITS)[number];
export type PhotoSize = (typeof PHOTO_SIZES)[number];

export const formatOf = (v: unknown): Format => (FORMATS as readonly string[]).includes(String(v)) ? (v as Format) : "classic";
export const fitOf = (v: unknown): Fit => (FITS as readonly string[]).includes(String(v)) ? (v as Fit) : "full";
export const photoSizeOf = (v: unknown): PhotoSize => (PHOTO_SIZES as readonly string[]).includes(String(v)) ? (v as PhotoSize) : "small";

// One side holds less words than the back of a classic card. The same function runs on the phone and on the server;
// length is JavaScript's .length (an emoji counts as 2) in both places.
export const ONESIDE_MAX = 160;
export const oneSideTooLong = (message: string) => message.length > ONESIDE_MAX;

// Where things sit on a one-side card, as shares of the card's width (W) and height (H). The card is 3:2.
export type OneSideGeo = {
  print: { x: number; y: number; w: number; rot: number };
  tape: { x: number; y: number; w: number; h: number; rot: number };
  note: { x: number; w: number; top: number; bottom: number };
  font: number; // base writing size, in card widths, for a hand of size 1.12 (scaled by hand.size / 1.12)
};
export const ONESIDE: Record<PhotoSize, OneSideGeo> = {
  small: { print: { x: 0.069, y: 0.197, w: 0.337, rot: -4 }, tape: { x: 0.149, y: 0.155, w: 0.16, h: 0.069, rot: -8 }, note: { x: 0.469, w: 0.48, top: 0.2, bottom: 0.85 }, font: 0.0657 },
  medium: { print: { x: 0.069, y: 0.17, w: 0.42, rot: -4 }, tape: { x: 0.19, y: 0.128, w: 0.16, h: 0.069, rot: -8 }, note: { x: 0.55, w: 0.4, top: 0.2, bottom: 0.85 }, font: 0.058 },
  large: { print: { x: 0.05, y: 0.13, w: 0.5, rot: -3 }, tape: { x: 0.21, y: 0.088, w: 0.16, h: 0.069, rot: -8 }, note: { x: 0.62, w: 0.33, top: 0.2, bottom: 0.85 }, font: 0.05 },
};
// Stamp, waves and sign-off, shared by every size.
export const ONESIDE_STAMP = { right: 0.04, top: 0.05, w: 0.137 };
export const ONESIDE_WAVES = { right: 0.16, top: 0.103, w: 0.229 };
export const ONESIDE_SIGN = { right: 0.063, bottom: 0.069 };
