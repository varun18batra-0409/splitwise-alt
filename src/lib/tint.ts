import photos from "../generated/photos.json"; // relative, so the test tools can load it too
import { coverOf, type CoverChoice } from "./covers";
import { placePhoto } from "./places";

// Each group's screens take on the colour of its picture: a Thailand trip goes deep sea-teal,
// Manali slate blue, Jaipur amber, a flat warm sand. Still Loopin's black underneath, just
// tinted, so money colours (green owed, orange owe) stay as clear as everywhere else.
//
// The colour comes from the photo itself when the build measured it (photos.json "tone"),
// otherwise from what the picture shows (beach, mountains, city…).

export type Tint = { hue: number; canvas: string; card: string; mist: string; line: string; accent: string };

const have = photos as Record<string, { src: string; tone?: string } | undefined>;

// What a picture shows → its hue (degrees) and how colourful the tint may get (0..1).
const HUES: [RegExp, number, number][] = [
  [/beach|sea|island|goa|gokarna|thailand|phuket|krabi|bali|maldives|andaman|lagoon|lake|pondicherry|varkala|kerala|alleppey|lakshadweep/i, 182, 1],
  [/mountain|manali|ladakh|leh|spiti|himalaya|snow|kashmir|shimla|mussoorie|rishikesh|darjeeling|sikkim|nepal|swiss|alps|road|trek/i, 216, 0.9],
  [/forest|coorg|munnar|wayanad|ooty|meghalaya|jungle|safari|kodaikanal/i, 148, 0.85],
  [/city|jaipur|udaipur|jodhpur|jaisalmer|rajasthan|desert|taj|agra|delhi|varanasi|hampi|mumbai|dubai|paris|london|rome|istanbul/i, 30, 0.9],
  [/food|dinner|cafe|party|birthday|diwali|holi|brunch|lunch|drinks/i, 14, 0.8],
  [/couple|wedding|honeymoon|date/i, 340, 0.7],
  [/cards|pot|poker|teen patti|game/i, 152, 0.8],
  [/home|flat|room|house|pg|hostel|rent/i, 38, 0.55],
];

const DRAWN: Partial<Record<CoverChoice, string>> = {
  beach: "beach",
  mountain: "mountain",
  city: "city",
  couple: "couple",
  dinner: "dinner",
  diwali: "diwali",
  cards: "cards",
};

type G = { id?: string; name: string; type: string; cover?: string | null; coverAt?: Date | null; tripPlace?: string | null };

// The photo-measured colour, if any: the trip's place photo, or the group's chosen photo.
function measured(g: G): string | undefined {
  const kind = coverOf(g);
  if (kind === "own") return undefined;
  if (g.type === "trip" && !g.cover) {
    const p = placePhoto(g.name);
    const t = p ? have[p.slot]?.tone : undefined;
    if (t) return t;
  }
  if (typeof kind === "string" && kind.startsWith("photo-")) return have[`cover-${kind.slice(6)}`]?.tone;
  return undefined;
}

export function groupTint(g: G): Tint | null {
  const tone = measured(g);
  if (tone) {
    const { h, s } = hsl(tone);
    if (s >= 0.08) return palette(h, Math.min(1, s * 1.6));
  }
  const kind = coverOf(g);
  const text = `${g.name} ${g.tripPlace ?? ""} ${DRAWN[kind] ?? (typeof kind === "string" ? kind : "")} ${g.type === "pot" ? "cards" : g.type === "home" ? "home" : g.type === "couple" ? "couple" : ""}`;
  const hit = HUES.find(([re]) => re.test(text));
  if (hit) return palette(hit[1], hit[2]);
  if (g.type === "trip") return palette(182, 0.8);
  return null; // no clear colour: Loopin's plain black
}

// One hue → the five surfaces, all very dark so text and money colours keep their contrast.
function palette(h: number, strength: number): Tint {
  const s = (base: number) => Math.round(base * strength);
  return {
    hue: h,
    canvas: `hsl(${h} ${s(32)}% 6.5%)`,
    card: `hsl(${h} ${s(26)}% 10.5%)`,
    mist: `hsl(${h} ${s(24)}% 14%)`,
    line: `hsl(${h} ${s(22)}% 19%)`,
    accent: `hsl(${h} ${s(60)}% 78%)`,
  };
}

// The CSS variables a tinted screen sets (Tailwind's bg-canvas, bg-white, bg-mist and border-line read them).
export function tintStyle(t: Tint | null): Record<string, string> | undefined {
  if (!t) return undefined;
  return { "--color-canvas": t.canvas, "--color-white": t.card, "--color-mist": t.mist, "--color-line": t.line, "--color-tint": t.accent };
}

function hsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: Math.round(h * 60), s, l };
}
