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

// ---------- Wax seals ----------
// A pressed wax seal: an uneven puddle of wax with drips, the pressed disc, and the design embossed
// into it (a dark edge below, a light edge above). Metallic waxes get a brighter sheen.
export const SEAL_COLOURS = [
  { id: "crimson", name: "Crimson", hi: "#d64550", mid: "#9e1b2a", lo: "#4f0a12" },
  { id: "scarlet", name: "Scarlet", hi: "#f0634e", mid: "#c0281c", lo: "#6a1108" },
  { id: "burgundy", name: "Burgundy", hi: "#a3405c", mid: "#5e1428", lo: "#2c0712" },
  { id: "blush", name: "Blush", hi: "#f4c4c2", mid: "#c97c84", lo: "#7a3d45" },
  { id: "gold", name: "Gold", hi: "#fff1b8", mid: "#c9a24a", lo: "#5e4512", metal: true },
  { id: "bronze", name: "Bronze", hi: "#f2c08c", mid: "#a0632f", lo: "#45260e", metal: true },
  { id: "silver", name: "Silver", hi: "#ffffff", mid: "#a9adb3", lo: "#3e4248", metal: true },
  { id: "navy", name: "Navy", hi: "#6a88c8", mid: "#1f3366", lo: "#0b1430" },
  { id: "forest", name: "Forest", hi: "#6aa67e", mid: "#255c3c", lo: "#0c2717" },
  { id: "black", name: "Black", hi: "#777777", mid: "#262626", lo: "#050505" },
] as const;
export const SEAL_DESIGNS = [
  { id: "initial", name: "Your initial" },
  { id: "crest", name: "Crest" },
  { id: "fleur", name: "Fleur-de-lis" },
  { id: "heart", name: "Heart" },
  { id: "star", name: "Star" },
  { id: "xo", name: "XO" },
] as const;
export function sealOf(spec: string): { colour: string; design: string } {
  const [c, d] = String(spec || "").split(":");
  return { colour: SEAL_COLOURS.some((x) => x.id === c) ? c : "crimson", design: SEAL_DESIGNS.some((x) => x.id === d) ? d : "initial" };
}
export const cleanSeal = (spec: string) => {
  const s = sealOf(spec);
  return `${s.colour}:${s.design}`;
};

const BLOB = "M90.5 44.3 Q92.1 50.0 90.8 55.8 Q89.5 61.6 88.2 67.6 Q86.8 73.7 81.8 77.2 Q76.7 80.8 72.3 85.1 Q67.9 89.3 62.0 90.6 Q56.0 91.9 49.7 94.3 Q43.3 96.7 36.4 95.9 Q29.4 95.1 26.4 87.9 Q23.4 80.7 18.8 76.9 Q14.1 73.1 12.5 67.3 Q10.9 61.5 10.0 55.7 Q9.1 50.0 9.1 44.0 Q9.1 38.0 10.8 31.9 Q12.4 25.8 17.8 22.4 Q23.1 19.0 27.0 13.5 Q30.9 8.1 37.3 7.4 Q43.8 6.8 50.1 6.0 Q56.5 5.1 62.2 7.8 Q68.0 10.5 72.9 14.2 Q77.8 17.9 83.0 21.7 Q88.3 25.4 88.6 32.0 Q89.0 38.5 90.5 44.3 Z";
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function sealArt(design: string, glyph: string, ring: string): string {
  switch (design) {
    case "fleur":
      return '<path d="M50 27 C45 34 44 42 50 51 C56 42 55 34 50 27Z M48.5 51 C44 44 36 43 33 47 C31 51 35 55 39 53 C36 52 36 49 39 48 C43 47 46 50 47.5 53Z M51.5 51 C56 44 64 43 67 47 C69 51 65 55 61 53 C64 52 64 49 61 48 C57 47 54 50 52.5 53Z M40 53.5 H60 V57 H40Z M48 57 H52 L53 68 H47Z M44 68 H56" stroke-width="1.2" stroke-linejoin="round"/>';
    case "heart":
      return '<path d="M50 70 C36 59 29 51 29 42 C29 35 34 31 40 31 C45 31 48 34 50 38 C52 34 55 31 60 31 C66 31 71 35 71 42 C71 51 64 59 50 70Z" stroke-width="1.6"/>';
    case "star":
      return '<path d="M50 28 L55.6 43.2 L71.6 43.6 L58.9 53.4 L63.4 69 L50 59.8 L36.6 69 L41.1 53.4 L28.4 43.6 L44.4 43.2Z" stroke-width="1.4" stroke-linejoin="round"/>';
    case "xo":
      return '<text x="50" y="59" text-anchor="middle" font-family="Georgia, serif" font-size="25" font-weight="700" letter-spacing="1">XO</text>';
    case "crest":
      return `<defs><path id="__RING__" d="M50 50 m-23 0 a23 23 0 1 1 46 0 a23 23 0 1 1 -46 0"/></defs><text font-family="Georgia, serif" font-size="7.2" font-weight="700" letter-spacing="2.4"><textPath href="#__RING__">${esc(ring)}</textPath></text><text x="50" y="58" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="22" font-weight="700">${esc(glyph)}</text>`;
    default:
      return `<text x="50" y="${glyph.length > 2 ? 56 : 62}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="${glyph.length > 2 ? 17 : glyph.length > 1 ? 24 : 34}" font-weight="700">${esc(glyph)}</text>`;
  }
}

export function waxSeal(spec: string, initial: string, k: string, glyphOverride?: string): string {
  const { colour, design } = sealOf(spec);
  const c = SEAL_COLOURS.find((x) => x.id === colour)!;
  const id = `w${k.replace(/[^a-z0-9]/gi, "")}`;
  const glyph = glyphOverride ?? ((initial || "L").trim().charAt(0).toUpperCase() || "L");
  const art = sealArt(glyphOverride ? "initial" : design, glyph, "WITH LOVE \u2726 LOOPIN POST \u2726 ").replaceAll("__RING__", `${id}r`);
  const metal = "metal" in c && c.metal;
  // The design twice: a dark copy a touch lower (the pressed edge) and a light copy a touch higher.
  const emboss = (fill: string, op: number, dy: number) => `<g transform="translate(0 ${dy})" fill="${design === "fleur" || design === "heart" || design === "star" ? "none" : fill}" stroke="${design === "fleur" || design === "heart" || design === "star" ? fill : "none"}" opacity="${op}">${art}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><defs><radialGradient id="${id}a" cx="36%" cy="30%" r="80%"><stop offset="0" stop-color="${c.hi}"/><stop offset=".42" stop-color="${c.mid}"/><stop offset="1" stop-color="${c.lo}"/></radialGradient><radialGradient id="${id}b" cx="62%" cy="68%" r="70%"><stop offset="0" stop-color="${c.hi}" stop-opacity="${metal ? 0.55 : 0.25}"/><stop offset=".55" stop-color="${c.mid}" stop-opacity="0"/></radialGradient><radialGradient id="${id}c" cx="50%" cy="50%" r="50%"><stop offset=".78" stop-color="${c.mid}"/><stop offset=".93" stop-color="${c.lo}"/><stop offset="1" stop-color="${c.hi}" stop-opacity=".6"/></radialGradient></defs><path d="${BLOB}" fill="url(#${id}a)"/><path d="${BLOB}" fill="url(#${id}b)"/><circle cx="50" cy="50" r="31.5" fill="url(#${id}c)"/><circle cx="50" cy="50" r="31.5" fill="none" stroke="${c.lo}" stroke-opacity=".55" stroke-width="1.6"/><path d="M24 40 A28 28 0 0 1 60 22" fill="none" stroke="${c.hi}" stroke-opacity="${metal ? 0.8 : 0.45}" stroke-width="1.4" stroke-linecap="round"/>${emboss(c.lo, 0.75, 0.9)}${emboss(c.hi, metal ? 0.85 : 0.6, -0.7)}<ellipse cx="33" cy="25" rx="11" ry="4.5" fill="#fff" opacity="${metal ? 0.42 : 0.2}" transform="rotate(-32 33 25)"/></svg>`;
}
const seal = (glyph: string, k: string) => waxSeal("crimson:initial", glyph, k, glyph);

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
    x: 0.03,
    y: 0.36,
    w: 0.16,
    rot: 14,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 170" width="120" height="170"><g fill="none" stroke="#5f6b3a" stroke-width="2.2" stroke-linecap="round"><path d="M60 168 C58 130 62 100 60 62"/><path d="M60 120 C48 112 38 114 30 120 C40 124 50 124 60 120Z" fill="#7d8a4c" fill-opacity=".85"/><path d="M60 100 C72 92 84 94 92 100 C82 104 72 104 60 100Z" fill="#7d8a4c" fill-opacity=".85"/></g><g transform="translate(60 48)">${[0, 72, 144, 216, 288]
      .map((a) => `<ellipse rx="11" ry="22" cy="-20" fill="#c98b8f" fill-opacity=".82" stroke="#a0636a" stroke-width="1" transform="rotate(${a})"/>`)
      .join("")}<circle r="7" fill="#d9b25a" stroke="#a5822f"/></g></svg>`,
  },
  {
    id: "corners",
    name: "Photo corners",
    side: "front",
    x: 0,
    y: 0,
    w: 1,
    rot: 0,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" width="300" height="200"><g fill="#1c1a17" fill-opacity=".92"><path d="M0 0 H34 L0 34Z"/><path d="M300 0 H266 L300 34Z"/><path d="M0 200 H34 L0 166Z"/><path d="M300 200 H266 L300 166Z"/></g><g stroke="#fff" stroke-opacity=".18" stroke-width=".8" fill="none"><path d="M34 0 L0 34 M266 0 L300 34 M34 200 L0 166 M266 200 L300 166"/></g></svg>`,
  },
  {
    id: "clip",
    name: "Paper clip",
    side: "front",
    x: 0.12,
    y: -0.035,
    w: 0.07,
    rot: 4,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 110" width="40" height="110"><defs><linearGradient id="clipg" x1="0" x2="1"><stop offset="0" stop-color="#8d939a"/><stop offset=".45" stop-color="#f3f5f7"/><stop offset="1" stop-color="#7c8188"/></linearGradient></defs><path d="M14 30 V90 a8 8 0 0 0 16 0 V18 a12 12 0 0 0 -24 0 V84" fill="none" stroke="url(#clipg)" stroke-width="3.6" stroke-linecap="round"/></svg>`,
  },
  {
    id: "ticket",
    name: "Rail ticket",
    side: "front",
    x: 0.64,
    y: 0.08,
    w: 0.27,
    rot: 6,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 110" width="220" height="110"><defs><mask id="tkm"><rect width="220" height="110" fill="#fff"/><circle cx="160" cy="0" r="7" fill="#000"/><circle cx="160" cy="110" r="7" fill="#000"/></mask></defs><g mask="url(#tkm)"><rect width="220" height="110" rx="4" fill="#e9d9b4"/><rect x="7" y="7" width="206" height="96" rx="2" fill="none" stroke="#7a4a2a" stroke-width="1.2"/><path d="M160 10 V100" stroke="#7a4a2a" stroke-dasharray="3 3"/><text x="18" y="30" font-family="Georgia, serif" font-size="10" letter-spacing="2.5" fill="#7a4a2a">INDIAN RAILWAYS</text><text x="18" y="58" font-family="Georgia, serif" font-size="21" font-weight="700" fill="#4a2a18">SECOND CLASS</text><text x="18" y="80" font-family="Arial, sans-serif" font-size="9" letter-spacing="1.5" fill="#7a4a2a">ONE WAY · VALID FOR ONE JOURNEY</text><text x="18" y="94" font-family="Courier New, monospace" font-size="9" fill="#7a4a2a">No. 04817</text><text x="190" y="62" text-anchor="middle" font-family="Georgia, serif" font-size="13" font-weight="700" fill="#a3322a" transform="rotate(-90 190 58)">ADMIT ONE</text></g></svg>`,
  },
  {
    id: "lovestamp",
    name: "Posted with love",
    side: "back",
    x: 0.63,
    y: 0.4,
    w: 0.2,
    rot: -11,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120"><g fill="none" stroke="#b0322f" stroke-opacity=".78"><circle cx="60" cy="60" r="55" stroke-width="3"/><circle cx="60" cy="60" r="47" stroke-width="1.2"/></g><defs><path id="lvr" d="M60 60 m-40 0 a40 40 0 1 1 80 0 a40 40 0 1 1 -80 0"/></defs><text font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="800" letter-spacing="3.2" fill="#b0322f" fill-opacity=".8"><textPath href="#lvr">POSTED WITH LOVE ✦ POSTED WITH LOVE ✦</textPath></text><path d="M60 77 C49 69 44 63 44 57 C44 52 48 49 52 49 C56 49 58 51 60 54 C62 51 64 49 68 49 C72 49 76 52 76 57 C76 63 71 69 60 77Z" fill="#b0322f" fill-opacity=".72"/></svg>`,
  },
  {
    id: "express",
    name: "Express",
    side: "back",
    x: 0.3,
    y: 0.08,
    w: 0.22,
    rot: -6,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60" width="200" height="60"><g opacity=".78"><rect x="3" y="3" width="194" height="54" rx="4" fill="none" stroke="#b0322f" stroke-width="3.5"/><text x="100" y="40" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="27" font-weight="900" letter-spacing="5" fill="#b0322f">EXPRESS</text></g></svg>`,
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
