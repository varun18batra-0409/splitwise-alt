// Photo looks, word placement, finishing touches and wax-seal replies for postcards.
// Ids are stored on the postcard, so never rename one (add new ones instead).

// ---------- Photo looks (film-style filters, with a strength) ----------
type Look = { id: string; name: string; sepia?: number; gray?: number; sat?: number; con?: number; bri?: number; hue?: number };
export const LOOKS: Look[] = [
  { id: "none", name: "Natural" },
  { id: "golden", name: "Golden hour", sepia: 0.22, sat: 1.25, con: 1.05, bri: 1.05, hue: -8 },
  { id: "kodak", name: "Kodak warm", sepia: 0.14, sat: 1.35, con: 1.1, hue: -4 },
  { id: "faded", name: "Faded 70s", sepia: 0.35, sat: 0.78, con: 0.84, bri: 1.08 },
  { id: "matte", name: "Matte", sat: 0.88, con: 0.82, bri: 1.1 },
  { id: "riviera", name: "Riviera", sat: 1.15, con: 1.06, bri: 1.04, hue: 10 },
  { id: "cool", name: "Nordic", sat: 0.85, con: 1.05, bri: 1.03, hue: 14 },
  { id: "bw", name: "Black & white", gray: 1, con: 1.18 },
  { id: "sepia", name: "Old print", sepia: 0.85, con: 1.05, bri: 0.98 },
];

// "golden:70" → the look and its strength (0–100).
export function lookOf(spec: string): { id: string; amount: number } {
  const [id, n] = String(spec || "").split(":");
  const look = LOOKS.find((l) => l.id === id);
  if (!look || look.id === "none") return { id: "none", amount: 0 };
  const amount = Math.max(0, Math.min(100, Math.round(Number(n ?? 100))));
  return { id: look.id, amount: Number.isFinite(amount) ? amount : 100 };
}
export const cleanLook = (spec: string) => {
  const l = lookOf(spec);
  return l.id === "none" ? "" : `${l.id}:${l.amount}`;
};

// The CSS filter for a look (also used on the canvas for the WhatsApp picture).
export function lookCss(spec: string): string {
  const { id, amount } = lookOf(spec);
  const l = LOOKS.find((x) => x.id === id);
  if (!l || id === "none" || !amount) return "none";
  const t = amount / 100;
  const mul = (v: number | undefined) => (1 + ((v ?? 1) - 1) * t).toFixed(3);
  const parts = [`saturate(${mul(l.sat)})`, `contrast(${mul(l.con)})`, `brightness(${mul(l.bri)})`];
  if (l.sepia) parts.push(`sepia(${(l.sepia * t).toFixed(3)})`);
  if (l.gray) parts.push(`grayscale(${(l.gray * t).toFixed(3)})`);
  if (l.hue) parts.push(`hue-rotate(${(l.hue * t).toFixed(1)}deg)`);
  return parts.join(" ");
}

// ---------- Where the words sit, and how big ----------
export const PLACES = [
  { id: "top", name: "Top" },
  { id: "middle", name: "Middle" },
  { id: "bottom", name: "Bottom" },
] as const;
export const wordsAtOf = (id: string) => (PLACES.some((p) => p.id === id) ? id : "bottom") as "top" | "middle" | "bottom";
export const wordsSizeOf = (n: unknown) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(60, Math.min(150, v)) : 100;
};

// ---------- Finishing touches ----------
// Each is drawn on one side of the card, at a fixed spot (shares of the card's width/height).
export type Touch = { id: string; name: string; side: "front" | "back"; x: number; y: number; w: number; rot: number; svg: string };

const seal = (glyph: string, k: string, col = "#8e1f26") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><defs><radialGradient id="s${k}" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#d0505a"/><stop offset=".45" stop-color="${col}"/><stop offset="1" stop-color="#4e0d12"/></radialGradient></defs><path d="M50 4 C62 3 70 9 78 14 C88 20 97 30 96 44 C99 56 95 68 88 77 C81 88 68 97 54 96 C40 99 27 94 18 86 C8 78 3 64 4 50 C2 36 9 22 20 13 C29 6 39 5 50 4Z" fill="url(#s${k})"/><circle cx="50" cy="50" r="31" fill="none" stroke="#3e0a0e" stroke-opacity=".55" stroke-width="2.2"/><circle cx="50" cy="50" r="31" fill="none" stroke="#f3a2a6" stroke-opacity=".25" stroke-width="1" transform="translate(-1 -1)"/><text x="50" y="${glyph.length > 2 ? 57 : 62}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="${glyph.length > 2 ? 17 : 34}" font-weight="700" fill="#3e0a0e" fill-opacity=".7">${glyph}</text><text x="50" y="${glyph.length > 2 ? 56 : 61}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="${glyph.length > 2 ? 17 : 34}" font-weight="700" fill="#ffd3d6" fill-opacity=".72">${glyph}</text><ellipse cx="36" cy="28" rx="12" ry="6" fill="#fff" opacity=".18" transform="rotate(-30 36 28)"/></svg>`;

export const TOUCHES: Touch[] = [
  { id: "seal", name: "Wax seal", side: "back", x: 0.4, y: 0.74, w: 0.13, rot: -8, svg: seal("L", "touch") },
  {
    id: "paravion",
    name: "Par avion",
    side: "back",
    x: 0.06,
    y: 0.12,
    w: 0.24,
    rot: -3,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 64" width="240" height="64"><rect x="2" y="2" width="236" height="60" rx="5" fill="#f4f1ea" stroke="#1e4f9a" stroke-width="3"/><rect x="8" y="8" width="224" height="48" rx="3" fill="none" stroke="#1e4f9a" stroke-width="1"/><text x="120" y="31" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="800" letter-spacing="4" fill="#1e4f9a">PAR AVION</text><text x="120" y="48" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="10.5" font-weight="700" letter-spacing="3" fill="#1e4f9a">BY AIR MAIL</text></svg>`,
  },
  {
    id: "tape",
    name: "Tape",
    side: "front",
    x: -0.03,
    y: 0.02,
    w: 0.22,
    rot: -32,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 56" width="220" height="56"><path d="M4 4 l6 4 l-5 5 l5 5 l-5 5 l5 5 l-5 5 l5 5 l-5 5 l4 5 H216 l-4 -5 l5 -5 l-5 -5 l5 -5 l-5 -5 l5 -5 l-5 -5 l5 -5 l-5 -5 l4 -4Z" fill="#efe6cf" fill-opacity=".78"/><path d="M4 4 H216" stroke="#fff" stroke-opacity=".5"/></svg>`,
  },
  {
    id: "flower",
    name: "Pressed flower",
    side: "front",
    x: 0.8,
    y: 0.05,
    w: 0.16,
    rot: 14,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 170" width="120" height="170"><g fill="none" stroke="#5f6b3a" stroke-width="2.2" stroke-linecap="round"><path d="M60 168 C58 130 62 100 60 62"/><path d="M60 120 C48 112 38 114 30 120 C40 124 50 124 60 120Z" fill="#7d8a4c" fill-opacity=".85"/><path d="M60 100 C72 92 84 94 92 100 C82 104 72 104 60 100Z" fill="#7d8a4c" fill-opacity=".85"/></g><g transform="translate(60 48)">${[0, 72, 144, 216, 288]
      .map((a) => `<ellipse rx="11" ry="22" cy="-20" fill="#c98b8f" fill-opacity=".82" stroke="#a0636a" stroke-width="1" transform="rotate(${a})"/>`)
      .join("")}<circle r="7" fill="#d9b25a" stroke="#a5822f"/></g></svg>`,
  },
];
export const cleanTouches = (raw: string) =>
  [...new Set(String(raw || "").split(","))]
    .filter((t) => TOUCHES.some((x) => x.id === t))
    .join(",");
export const touchesOn = (raw: string | undefined, side: "front" | "back") => {
  const ids = new Set(String(raw || "").split(","));
  return TOUCHES.filter((t) => t.side === side && ids.has(t.id));
};

// ---------- Wax-seal replies ----------
export const REACTIONS = [
  { id: "love", name: "Love it", glyph: "♥" },
  { id: "miss", name: "Miss you", glyph: "Miss" },
  { id: "day", name: "Made my day", glyph: "☼" },
  { id: "soon", name: "See you soon", glyph: "Soon" },
  { id: "ha", name: "Ha!", glyph: "Ha!" },
] as const;
export const reactionOf = (id: string) => REACTIONS.find((r) => r.id === id);
export const reactionSvg = (id: string, k = "r") => {
  const r = reactionOf(id);
  return r ? seal(r.glyph, `${id}${k.replace(/[^a-z0-9]/gi, "")}`) : "";
};
