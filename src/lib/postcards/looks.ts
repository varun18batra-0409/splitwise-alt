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
export type Touch = { id: string; name: string; side: "front" | "back"; x: number; y: number; w: number; rot: number; svg: string; hidden?: boolean };

// ---------- Wax seals ----------
// A pressed wax seal: an uneven puddle of wax with drips, the pressed disc, and the design embossed
// into it (a dark edge below, a light edge above). Metallic waxes get a brighter sheen.
export const SEAL_COLOURS = [
  { id: "crimson", name: "Crimson", hi: "#d64550", mid: "#9e1b2a", lo: "#4f0a12" },
  { id: "scarlet", name: "Scarlet", hi: "#f0634e", mid: "#c0281c", lo: "#6a1108" },
  { id: "burgundy", name: "Burgundy", hi: "#a3405c", mid: "#5e1428", lo: "#2c0712" },
  { id: "blush", name: "Blush", hi: "#f4c4c2", mid: "#c97c84", lo: "#7a3d45" },
  { id: "gold", name: "Gold", hi: "#f7dc84", mid: "#b98b2c", lo: "#4e360a", metal: true },
  { id: "bronze", name: "Bronze", hi: "#f2c08c", mid: "#a0632f", lo: "#45260e", metal: true },
  { id: "silver", name: "Silver", hi: "#f2f4f6", mid: "#9a9fa6", lo: "#33373c", metal: true },
  { id: "navy", name: "Navy", hi: "#6a88c8", mid: "#1f3366", lo: "#0b1430" },
  { id: "forest", name: "Forest", hi: "#6aa67e", mid: "#255c3c", lo: "#0c2717" },
  { id: "black", name: "Black", hi: "#777777", mid: "#262626", lo: "#050505" },
  { id: "plum", name: "Plum", hi: "#a56a9a", mid: "#5a2350", lo: "#260a22" },
  { id: "sapphire", name: "Sapphire", hi: "#6fa0e8", mid: "#1d4fa0", lo: "#0a1f4a" },
  { id: "teal", name: "Teal", hi: "#6cc0bc", mid: "#1f6e6a", lo: "#0a2e2c" },
  { id: "olive", name: "Olive", hi: "#b5b36a", mid: "#6b6a2a", lo: "#2c2b0c" },
  { id: "ochre", name: "Ochre", hi: "#f2cd6e", mid: "#c08a1e", lo: "#5a3c08" },
  { id: "copper", name: "Copper", hi: "#ffc4a0", mid: "#b5643a", lo: "#4e230e", metal: true },
  { id: "rosegold", name: "Rose gold", hi: "#ffe0d8", mid: "#c98c80", lo: "#6a3a33", metal: true },
  { id: "pearl", name: "Pearl", hi: "#ffffff", mid: "#e6e0d4", lo: "#9a9282", metal: true },
] as const;
export const SEAL_DESIGNS = [
  { id: "initial", name: "Your initial" },
  { id: "crest", name: "Crest" },
  { id: "fleur", name: "Fleur-de-lis" },
  { id: "heart", name: "Heart" },
  { id: "star", name: "Star" },
  { id: "xo", name: "XO" },
  { id: "rose", name: "Rose" },
  { id: "crown", name: "Crown" },
  { id: "laurel", name: "Laurel" },
  { id: "compass", name: "Compass" },
  { id: "anchor", name: "Anchor" },
  { id: "key", name: "Key" },
  { id: "moon", name: "Moon" },
  { id: "plane", name: "Airmail" },
  { id: "bee", name: "Bee" },
  { id: "infinity", name: "Forever" },
] as const;
// Designs drawn as engraved lines (the rest are lettering).
const LINE_DESIGNS = new Set(["fleur", "heart", "star", "rose", "crown", "laurel", "compass", "anchor", "key", "moon", "plane", "bee", "infinity"]);
export function sealOf(spec: string): { colour: string; design: string } {
  const [c, d] = String(spec || "").split(":");
  return { colour: SEAL_COLOURS.some((x) => x.id === c) ? c : "crimson", design: SEAL_DESIGNS.some((x) => x.id === d) ? d : "initial" };
}
export const cleanSeal = (spec: string) => {
  const s = sealOf(spec);
  return `${s.colour}:${s.design}`;
};

const BLOB = "M94.3 46.5 Q94.7 50.0 94.4 53.5 Q94.0 57.0 93.0 60.3 Q92.1 63.7 91.1 67.1 Q90.1 70.4 89.6 74.4 Q89.1 78.4 85.1 79.8 Q81.2 81.2 77.8 82.4 Q74.4 83.6 71.7 85.5 Q69.0 87.3 65.9 88.4 Q62.8 89.4 59.6 89.8 Q56.4 90.2 53.2 89.5 Q50.0 88.9 46.9 88.8 Q43.9 88.8 40.7 88.5 Q37.6 88.2 34.0 88.3 Q30.4 88.5 27.0 87.5 Q23.6 86.4 20.6 84.4 Q17.6 82.4 13.7 80.8 Q9.8 79.2 9.8 74.9 Q9.8 70.5 10.0 66.7 Q10.1 63.0 10.2 59.6 Q10.4 56.3 10.9 53.1 Q11.3 50.0 11.5 47.0 Q11.7 43.9 11.5 40.7 Q11.3 37.4 12.4 34.4 Q13.5 31.4 14.9 28.4 Q16.2 25.5 18.3 23.0 Q20.4 20.4 23.1 18.5 Q25.7 16.6 28.2 14.4 Q30.8 12.2 33.1 8.8 Q35.5 5.4 39.3 5.7 Q43.0 5.9 46.5 5.7 Q50.0 5.5 53.5 5.7 Q57.0 5.9 60.2 7.4 Q63.4 8.9 66.1 10.9 Q68.9 13.0 71.0 15.6 Q73.1 18.2 74.9 20.7 Q76.8 23.2 79.3 25.0 Q81.9 26.9 84.2 29.1 Q86.5 31.4 88.6 34.1 Q90.7 36.8 92.3 39.9 Q93.8 43.1 94.3 46.5 Z";
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function sealArt(design: string, glyph: string, ring: string): string {
  switch (design) {
    case "fleur":
      return '<path d="M50 27 C45 34 44 42 50 51 C56 42 55 34 50 27Z M48.5 51 C44 44 36 43 33 47 C31 51 35 55 39 53 C36 52 36 49 39 48 C43 47 46 50 47.5 53Z M51.5 51 C56 44 64 43 67 47 C69 51 65 55 61 53 C64 52 64 49 61 48 C57 47 54 50 52.5 53Z M40 53.5 H60 V57 H40Z M48 57 H52 L53 68 H47Z M44 68 H56" stroke-width="1.2" stroke-linejoin="round"/>';
    case "heart":
      return '<path d="M50 70 C36 59 29 51 29 42 C29 35 34 31 40 31 C45 31 48 34 50 38 C52 34 55 31 60 31 C66 31 71 35 71 42 C71 51 64 59 50 70Z" stroke-width="1.6"/>';
    case "rose":
      return '<path d="M50 47 a3 3 0 1 1 3 3 a6.5 6.5 0 1 1 -6.5 -6.5 a10 10 0 1 1 10 10 a13 13 0 0 1 -13 -13" stroke-width="1.5" stroke-linecap="round"/><path d="M50 60 V72 M50 66 q-7 -1 -9 -6 q6 0 9 6 M50 69 q7 -1 9 -6 q-6 0 -9 6" stroke-width="1.4" stroke-linecap="round"/>';
    case "crown":
      return '<path d="M32 62 L29 39 L40 49 L50 32 L60 49 L71 39 L68 62Z M32 67 H68" stroke-width="1.6" stroke-linejoin="round"/><circle cx="29" cy="37" r="2"/><circle cx="50" cy="30" r="2"/><circle cx="71" cy="37" r="2"/><path d="M40 57 h20" stroke-width="1"/>';
    case "laurel":
      return '<path d="M44 70 C30 62 28 44 38 31 M56 70 C70 62 72 44 62 31" stroke-width="1.4" stroke-linecap="round"/><path d="M35 62 q-7 -1 -9 -7 q7 0 9 7 M32 52 q-7 -3 -7 -9 q7 2 7 9 M33 42 q-5 -5 -3 -11 q5 4 3 11 M65 62 q7 -1 9 -7 q-7 0 -9 7 M68 52 q7 -3 7 -9 q-7 2 -7 9 M67 42 q5 -5 3 -11 q-5 4 -3 11" stroke-width="1.2"/><path d="M44 70 L56 70" stroke-width="1.2"/>';
    case "compass":
      return '<circle cx="50" cy="50" r="21" stroke-width="1.1"/><path d="M50 27 L54.5 50 L50 73 L45.5 50Z M27 50 L50 45.5 L73 50 L50 54.5Z" stroke-width="1.3" stroke-linejoin="round"/><path d="M50 27 L54.5 50 L45.5 50Z" stroke-width="2.2"/><circle cx="50" cy="50" r="1.8"/>';
    case "anchor":
      return '<circle cx="50" cy="31" r="4" stroke-width="1.6"/><path d="M50 35 V70 M41 43 H59 M31 57 C33 66 41 70 50 70 C59 70 67 66 69 57 M28 60 L31 56 L35 59 M72 60 L69 56 L65 59" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
    case "key":
      return '<circle cx="36" cy="50" r="8.5" stroke-width="1.8"/><circle cx="36" cy="50" r="3.5" stroke-width="1.2"/><path d="M44.5 50 H72 M64 50 V58 M69 50 V56" stroke-width="2" stroke-linecap="round"/>';
    case "moon":
      return '<path d="M56 29 A22 22 0 1 0 64 66 A17 17 0 1 1 56 29Z" stroke-width="1.6" stroke-linejoin="round"/><path d="M63 38 l1.4 3.4 l3.6 .3 l-2.8 2.3 l.9 3.5 l-3.1 -1.9 l-3.1 1.9 l.9 -3.5 l-2.8 -2.3 l3.6 -.3Z" stroke-width="1"/>';
    case "plane":
      return '<path d="M28 52 L72 34 L62 66 L52 56 Z M52 56 L72 34 M52 56 L50 66 L56 60" stroke-width="1.6" stroke-linejoin="round"/><path d="M30 64 q6 -3 12 0" stroke-width="1" stroke-dasharray="2 2"/>';
    case "bee":
      return '<ellipse cx="50" cy="54" rx="9" ry="13" stroke-width="1.6"/><path d="M41.5 50 H58.5 M41 56 H59 M42.5 62 H57.5" stroke-width="1.3"/><circle cx="50" cy="38" r="4" stroke-width="1.5"/><path d="M41 47 C30 38 30 30 38 31 C44 32 45 40 44 46 M59 47 C70 38 70 30 62 31 C56 32 55 40 56 46 M48 35 l-3 -5 M52 35 l3 -5" stroke-width="1.3" stroke-linecap="round"/>';
    case "infinity":
      return '<path d="M50 50 C44 40 30 40 30 50 C30 60 44 60 50 50 C56 40 70 40 70 50 C70 60 56 60 50 50Z" stroke-width="2.2"/>';
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
  const shown = glyphOverride ? "initial" : design;
  const art = sealArt(shown, glyph, "WITH LOVE \u2726 LOOPIN POST \u2726 ").replaceAll("__RING__", `${id}r`);
  const metal = "metal" in c && c.metal;
  const lines = LINE_DESIGNS.has(shown);
  // Real wax, lit from the top left: a height map (puddle, sunken pressed disc, raised rim and
  // design) is turned into light and shade with SVG lighting, then tinted with the wax colour.
  const height = `<path d="${BLOB}" fill="url(#${id}e)"/><circle cx="50" cy="50" r="31" fill="#7a7a7a"/><circle cx="50" cy="50" r="31" fill="none" stroke="#d8d8d8" stroke-width="3.2"/><circle cx="50" cy="50" r="27.5" fill="none" stroke="#9a9a9a" stroke-width=".8"/><g fill="${lines ? "none" : "#d0d0d0"}" stroke="${lines ? "#d0d0d0" : "none"}">${lines ? art.replace(/stroke-width="([0-9.]+)"/g, (_, w) => `stroke-width="${Math.max(2.2, Number(w) * 1.5)}"`) : art}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><defs><radialGradient id="${id}e" cx="50%" cy="50%" r="50%"><stop offset=".55" stop-color="#e6e6e6"/><stop offset=".86" stop-color="#bdbdbd"/><stop offset="1" stop-color="#5a5a5a"/></radialGradient><radialGradient id="${id}t" cx="40%" cy="34%" r="75%"><stop offset="0" stop-color="${c.hi}"/><stop offset=".5" stop-color="${c.mid}"/><stop offset="1" stop-color="${c.lo}"/></radialGradient><filter id="${id}f" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0" result="h0"/><feGaussianBlur in="h0" stdDeviation="1.1" result="h"/><feDiffuseLighting in="h" surfaceScale="${metal ? 5 : 6}" diffuseConstant="1.05" lighting-color="#ffffff" result="diff"><feDistantLight azimuth="225" elevation="${metal ? 50 : 42}"/></feDiffuseLighting><feSpecularLighting in="h" surfaceScale="${metal ? 5 : 6}" specularConstant="${metal ? 1.3 : 0.75}" specularExponent="${metal ? 14 : 26}" lighting-color="#ffffff" result="spec"><feDistantLight azimuth="225" elevation="${metal ? 48 : 40}"/></feSpecularLighting><feComposite in="spec" in2="SourceAlpha" operator="in" result="spec2"/><feComposite in="diff" in2="SourceAlpha" operator="in" result="light"/></filter><filter id="${id}s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="1.6"/><feOffset dx="1.2" dy="2"/><feComponentTransfer><feFuncA type="linear" slope=".45"/></feComponentTransfer></filter><mask id="${id}m"><path d="${BLOB}" fill="#fff"/></mask></defs><path d="${BLOB}" filter="url(#${id}s)"/><g mask="url(#${id}m)"><rect width="100" height="100" fill="url(#${id}t)"/><g style="mix-blend-mode:multiply" filter="url(#${id}f)">${height}</g><g style="mix-blend-mode:screen" opacity="${metal ? 0.85 : 0.55}"><g filter="url(#${id}g)">${height}</g></g></g></svg>`.replace(
    "</filter><filter id=\"" + id + "s\"",
    `</filter><filter id="${id}g" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0" result="h0"/><feGaussianBlur in="h0" stdDeviation="1.1" result="h"/><feSpecularLighting in="h" surfaceScale="${metal ? 5 : 6}" specularConstant="${metal ? 1.3 : 0.8}" specularExponent="${metal ? 14 : 28}" lighting-color="#ffffff"><feDistantLight azimuth="225" elevation="${metal ? 48 : 40}"/></feSpecularLighting><feComposite in2="SourceAlpha" operator="in"/></filter><filter id="${id}s"`,
  );
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
    hidden: true, // retired from the picker; kept so cards that have them still show them
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
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 110" width="220" height="110"><defs><mask id="tkm"><rect width="220" height="110" fill="#fff"/><circle cx="160" cy="0" r="7" fill="#000"/><circle cx="160" cy="110" r="7" fill="#000"/></mask></defs><g mask="url(#tkm)"><rect width="220" height="110" rx="4" fill="#e9d9b4"/><rect x="7" y="7" width="206" height="96" rx="2" fill="none" stroke="#7a4a2a" stroke-width="1.2"/><path d="M160 10 V100" stroke="#7a4a2a" stroke-dasharray="3 3"/><text x="18" y="30" font-family="Georgia, serif" font-size="10" letter-spacing="2.5" fill="#7a4a2a">STATE RAILWAYS</text><text x="18" y="58" font-family="Georgia, serif" font-size="21" font-weight="700" fill="#4a2a18">SECOND CLASS</text><text x="18" y="80" font-family="Arial, sans-serif" font-size="9" letter-spacing="1.5" fill="#7a4a2a">ONE WAY · VALID FOR ONE JOURNEY</text><text x="18" y="94" font-family="Courier New, monospace" font-size="9" fill="#7a4a2a">No. 04817</text><text x="190" y="62" text-anchor="middle" font-family="Georgia, serif" font-size="13" font-weight="700" fill="#a3322a" transform="rotate(-90 190 58)">ADMIT ONE</text></g></svg>`,
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
  {
    id: "luggage",
    name: "Luggage tag",
    side: "front",
    x: 0.81,
    y: 0.5,
    w: 0.15,
    rot: 12,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 200" width="120" height="200"><path d="M60 4 C40 4 34 14 34 30" fill="none" stroke="#7a5a3a" stroke-width="2.4" stroke-linecap="round"/><path d="M18 40 L44 22 H76 L102 40 V188 a6 6 0 0 1 -6 6 H24 a6 6 0 0 1 -6 -6Z" fill="#e6cf9e" stroke="#9a7a4a" stroke-width="1.2"/><circle cx="60" cy="40" r="7" fill="#f6ecd2" stroke="#9a7a4a" stroke-width="2"/><g font-family="Georgia, serif" fill="#5a3a22"><text x="60" y="72" text-anchor="middle" font-size="10" letter-spacing="2.4">PASSENGER</text><path d="M30 98 H90 M30 124 H90 M30 150 H90" stroke="#9a7a4a" stroke-width=".9"/><text x="30" y="94" font-size="7.5" letter-spacing="1.4">NAME</text><text x="30" y="120" font-size="7.5" letter-spacing="1.4">FROM</text><text x="30" y="146" font-size="7.5" letter-spacing="1.4">TO</text><text x="60" y="178" text-anchor="middle" font-size="13" font-style="italic" font-weight="700" fill="#a3322a">Bon voyage</text></g></svg>`,
  },
  {
    id: "sticker",
    name: "Hotel sticker",
    side: "front",
    x: 0.03,
    y: 0.64,
    w: 0.19,
    rot: -9,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 130" width="200" height="130"><ellipse cx="100" cy="65" rx="96" ry="61" fill="#1f4a5a"/><ellipse cx="100" cy="65" rx="88" ry="53" fill="none" stroke="#e8c97a" stroke-width="2"/><ellipse cx="100" cy="65" rx="84" ry="49" fill="none" stroke="#e8c97a" stroke-width=".7"/><text x="100" y="46" text-anchor="middle" font-family="Georgia, serif" font-size="10" letter-spacing="4" fill="#e8c97a">GRAND</text><text x="100" y="76" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="28" font-weight="700" fill="#f6ecd2">Hotel</text><text x="100" y="96" text-anchor="middle" font-family="Georgia, serif" font-size="8" letter-spacing="3.5" fill="#e8c97a">EST. 1924 ✦ BY THE SEA</text><ellipse cx="100" cy="65" rx="96" ry="61" fill="#fff" opacity=".06"/></svg>`,
  },
  {
    id: "customs",
    name: "Customs label",
    side: "back",
    x: 0.07,
    y: 0.66,
    w: 0.26,
    rot: 3,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 110" width="200" height="110"><rect width="200" height="110" fill="#cfe3c4"/><rect x="5" y="5" width="190" height="100" fill="none" stroke="#2f5a34" stroke-width="1.4"/><text x="100" y="24" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="800" letter-spacing="2" fill="#2f5a34">CUSTOMS · DOUANE</text><text x="100" y="38" text-anchor="middle" font-family="Arial, sans-serif" font-size="8" letter-spacing="1.5" fill="#2f5a34">MAY BE OPENED OFFICIALLY</text><path d="M12 46 H188" stroke="#2f5a34"/><g font-family="Arial, sans-serif" font-size="8.5" fill="#2f5a34"><rect x="16" y="56" width="8" height="8" fill="none" stroke="#2f5a34"/><text x="30" y="63">Gift</text><path d="M17 59 l2.5 3 l5 -6" stroke="#a3322a" stroke-width="1.8" fill="none"/><rect x="72" y="56" width="8" height="8" fill="none" stroke="#2f5a34"/><text x="86" y="63">Memories</text><path d="M73 59 l2.5 3 l5 -6" stroke="#a3322a" stroke-width="1.8" fill="none"/><text x="16" y="86">Contents: one postcard, warm wishes</text><text x="16" y="99">Value: priceless</text></g></svg>`,
  },
  {
    id: "arrived",
    name: "Arrival stamp",
    side: "back",
    x: 0.66,
    y: 0.38,
    w: 0.22,
    rot: 9,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 90" width="140" height="90"><g fill="none" stroke="#2a4f8a" stroke-opacity=".8"><rect x="4" y="4" width="132" height="82" rx="14" stroke-width="3"/><rect x="11" y="11" width="118" height="68" rx="9" stroke-width="1"/></g><g font-family="Arial, Helvetica, sans-serif" fill="#2a4f8a" fill-opacity=".8" text-anchor="middle"><text x="70" y="32" font-size="9" letter-spacing="3">IMMIGRATION</text><text x="70" y="55" font-size="20" font-weight="800" letter-spacing="3">ARRIVED</text><text x="70" y="71" font-size="8" letter-spacing="2.5">✈ ADMITTED ✈</text></g></svg>`,
  },
  {
    id: "coffee",
    name: "Coffee ring",
    side: "back",
    x: 0.03,
    y: 0.2,
    w: 0.3,
    rot: 0,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160"><g fill="none" stroke="#8a5a2a"><circle cx="80" cy="80" r="62" stroke-width="5" stroke-opacity=".14"/><path d="M28 60 A58 58 0 0 1 132 68" stroke-width="2.4" stroke-opacity=".2"/><path d="M40 128 A60 60 0 0 0 138 92" stroke-width="1.6" stroke-opacity=".18"/></g><circle cx="80" cy="80" r="58" fill="#8a5a2a" opacity=".035"/></svg>`,
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
