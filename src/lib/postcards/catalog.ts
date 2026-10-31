import { ICONS, SCENES } from "./scenes";
import { countryOf } from "@/lib/geo";

// Everything a postcard can be made of: the fronts, lettering, handwriting, stamps and papers.
// Ids are stored on the postcard, so never rename one (add new ones instead).

// ---------- Fronts ----------
export type Print = { id: keyof typeof SCENES; name: string; place: string };
export const PRINTS: Print[] = [
  { id: "beach", name: "Beach at dusk", place: "Goa" },
  { id: "hills", name: "Mountains", place: "Manali" },
  { id: "desert", name: "Desert", place: "Jaisalmer" },
  { id: "backwaters", name: "Backwaters", place: "Kerala" },
  { id: "lake", name: "Lake palace", place: "Udaipur" },
  { id: "ladakh", name: "High road", place: "Ladakh" },
  { id: "tea", name: "Tea hills", place: "Munnar" },
  { id: "island", name: "Island", place: "Andaman" },
  { id: "ghats", name: "River ghats", place: "Varanasi" },
  { id: "city", name: "City by the sea", place: "Mumbai" },
  { id: "camp", name: "Under the stars", place: "Spiti" },
  { id: "monsoon", name: "Monsoon", place: "Lonavala" },
  { id: "lighthouse", name: "Lighthouse coast", place: "Kovalam" },
  { id: "snow", name: "Snow village", place: "Gulmarg" },
  { id: "cards", name: "Card night", place: "Card night" },
  { id: "home", name: "Home", place: "Home" },
];
export const isPrint = (id: string): id is Print["id"] => PRINTS.some((p) => p.id === id);

// The SVG for a print. `k` keeps gradient ids apart when several show on one screen.
export function printSvg(id: string, k: string): string {
  const fn = (SCENES as Record<string, (k: string) => string>)[id] ?? SCENES.beach;
  return fn(`pc${k.replace(/[^a-z0-9]/gi, "")}`);
}

// ---------- Lettering on the front ----------
export type Lettering = { id: string; name: string; family: string; italic?: boolean; caps?: boolean };
export const LETTERINGS: Lettering[] = [
  { id: "classic", name: "Classic", family: "DM Serif Display" },
  { id: "italic", name: "Italic", family: "Playfair Display", italic: true },
  { id: "poster", name: "Poster", family: "Bebas Neue", caps: true },
  { id: "bold", name: "Bold", family: "Abril Fatface" },
];
export const letteringOf = (id: string) => LETTERINGS.find((l) => l.id === id) ?? LETTERINGS[0];

// ---------- Handwriting ----------
export const HANDS: { id: string; family: string; size: number }[] = [
  { id: "caveat", family: "Caveat", size: 1.12 },
  { id: "homemade", family: "Homemade Apple", size: 0.78 },
  { id: "kalam", family: "Kalam", size: 0.92 },
  { id: "dancing", family: "Dancing Script", size: 1 },
  { id: "sacramento", family: "Sacramento", size: 1.25 },
  { id: "labelle", family: "La Belle Aurore", size: 1.05 },
  { id: "nothing", family: "Nothing You Could Do", size: 0.82 },
  { id: "cedarville", family: "Cedarville Cursive", size: 0.9 },
  { id: "satisfy", family: "Satisfy", size: 0.98 },
  { id: "parisienne", family: "Parisienne", size: 1.05 },
  { id: "reenie", family: "Reenie Beanie", size: 1.2 },
  { id: "patrick", family: "Patrick Hand", size: 0.98 },
];
export const handOf = (id: string) => HANDS.find((h) => h.id === id) ?? HANDS[0];

// Google Fonts for the lettering and handwriting (loaded only on postcard screens).
export const POSTCARD_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Playfair+Display:ital,wght@1,500&family=Bebas+Neue&family=Abril+Fatface&family=Caveat:wght@500&family=Homemade+Apple&family=Kalam&family=Dancing+Script:wght@500&family=Sacramento&family=La+Belle+Aurore&family=Nothing+You+Could+Do&family=Cedarville+Cursive&family=Satisfy&family=Parisienne&family=Reenie+Beanie&family=Patrick+Hand&display=swap";

// ---------- Paper ----------
// Each paper is three tones of one card stock (lit corner, middle, edge). Airmail is cream inside a striped border.
export const PAPERS = [
  { id: "cream", name: "Cream", g: ["#fbf7ef", "#f1e8d7", "#eadfca"] },
  { id: "ivory", name: "Ivory", g: ["#fdfcf8", "#f6f3ea", "#ece7da"] },
  { id: "airmail", name: "Airmail", g: ["#fbf7ef", "#f1e8d7", "#eadfca"] },
  { id: "kraft", name: "Kraft", g: ["#e3cfae", "#d2b98f", "#c8ad80"] },
  { id: "sage", name: "Sage", g: ["#eef1e6", "#dfe5d3", "#d2dac3"] },
  { id: "blush", name: "Blush", g: ["#faefe9", "#f1dfd6", "#e8d0c4"] },
  { id: "sky", name: "Sky", g: ["#eef3f6", "#dde7ee", "#cfdce6"] },
  { id: "dusk", name: "Dusk", g: ["#ece8f1", "#ddd6e6", "#cfc6db"] },
] as const;
export const paperOf = (id: string) => PAPERS.find((p) => p.id === id)?.id ?? "cream";
export const paperTones = (id: string) => (PAPERS.find((p) => p.id === id) ?? PAPERS[0]).g;

// ---------- Colour of the words on the front ----------
export const TONES = [
  { id: "white", name: "White", c: "#ffffff", dark: false },
  { id: "cream", name: "Cream", c: "#f6ead0", dark: false },
  { id: "gold", name: "Gold", c: "#f2c66d", dark: false },
  { id: "coral", name: "Coral", c: "#ff9a7a", dark: false },
  { id: "sea", name: "Sea glass", c: "#a9e4d6", dark: false },
  { id: "sky", name: "Sky", c: "#a8cdf5", dark: false },
  { id: "red", name: "Postbox red", c: "#c8312b", dark: true },
  { id: "navy", name: "Navy", c: "#1d2a52", dark: true },
  { id: "black", name: "Black", c: "#141414", dark: true },
] as const;
export const toneOf = (id: string) => TONES.find((t) => t.id === id) ?? TONES[0];

// ---------- Ink ----------
export const INKS = [
  { id: "navy", name: "Midnight", c: "#2b2a5a" },
  { id: "blue", name: "Royal blue", c: "#24489a" },
  { id: "black", name: "Black", c: "#1f1d1a" },
  { id: "sepia", name: "Sepia", c: "#6b3f22" },
  { id: "green", name: "Bottle green", c: "#1f5a44" },
  { id: "oxblood", name: "Oxblood", c: "#7a2230" },
  { id: "violet", name: "Violet", c: "#4f2f78" },
] as const;
export const inkOf = (id: string) => (INKS.find((i) => i.id === id) ?? INKS[0]).id;
export const inkColor = (id: string) => (INKS.find((i) => i.id === id) ?? INKS[0]).c;

// ---------- Warm openers ----------
export const OPENERS = [
  "Wish you were here.",
  "Thank you for ",
  "Remember when ",
  "Same time next year?",
  "Missing this already.",
  "Best trip, best people.",
];

// ---------- Stamps ----------
// One ink colour on tinted paper. Country stamps carry the landmark, the country and a local value.
type StampDef = { icon: string; ink: string; tint: string; value: string; name: string };
const COUNTRY: Record<string, Omit<StampDef, "name">> = {
  IN: { icon: "taj", ink: "#8a3b2a", tint: "#f6e2d6", value: "₹25" },
  TH: { icon: "wat", ink: "#2f4f8f", tint: "#e3e9f5", value: "฿15" },
  JP: { icon: "fuji", ink: "#a1262d", tint: "#f6e4e1", value: "¥90" },
  FR: { icon: "eiffel", ink: "#1f4f7a", tint: "#e2ebf2", value: "1,20€" },
  GB: { icon: "bigben", ink: "#5a2a5e", tint: "#efe3ef", value: "£1" },
  AE: { icon: "burj", ink: "#6a5a2a", tint: "#f2ecd9", value: "5 AED" },
  AU: { icon: "opera", ink: "#1f6a6a", tint: "#ddeeee", value: "$1.50" },
  US: { icon: "liberty", ink: "#2f6a4f", tint: "#e0eee6", value: "$0.73" },
  IT: { icon: "colosseum", ink: "#8a4a2a", tint: "#f4e6da", value: "1,30€" },
  GR: { icon: "column", ink: "#1f4f8a", tint: "#e2eaf5", value: "1€" },
  EG: { icon: "pyramid", ink: "#9a6a1a", tint: "#f6ecd6", value: "10 EGP" },
  NL: { icon: "windmill", ink: "#c05a1a", tint: "#f8e6d8", value: "1,15€" },
  NP: { icon: "stupa", ink: "#8a2a3a", tint: "#f4e0e4", value: "रू25" },
  TR: { icon: "mosque", ink: "#a1262d", tint: "#f6e4e1", value: "15 TL" },
  DE: { icon: "gate", ink: "#3a3a3a", tint: "#ebebeb", value: "0,95€" },
  LK: { icon: "elephant", ink: "#5a3a7a", tint: "#ece4f2", value: "Rs.50" },
  SG: { icon: "merlion", ink: "#b3262d", tint: "#f6e2e2", value: "$1" },
  ID: { icon: "temple", ink: "#7a5a1a", tint: "#f3ead6", value: "5000 Rp" },
  MV: { icon: "palm", ink: "#1f7a8a", tint: "#dff0f2", value: "Rf 5" },
  CH: { icon: "peak", ink: "#c0392b", tint: "#f7e3e1", value: "1.20 Fr" },
  BT: { icon: "temple", ink: "#a0522d", tint: "#f6e6da", value: "Nu 20" },
  VN: { icon: "boat", ink: "#a1262d", tint: "#f6e4e1", value: "15000₫" },
  MY: { icon: "gate", ink: "#1f3f7a", tint: "#e2e8f4", value: "RM2" },
  ES: { icon: "colosseum", ink: "#b3262d", tint: "#f8e6dc", value: "1,25€" },
};
const THEMES: Record<string, StampDef> = {
  beach: { icon: "palm", ink: "#1f6a7a", tint: "#dfeef0", value: "₹10", name: "Beach" },
  mountains: { icon: "peak", ink: "#3a4f6f", tint: "#e3e8ef", value: "₹10", name: "Mountains" },
  desert: { icon: "camel", ink: "#9a5a2a", tint: "#f6e8d6", value: "₹15", name: "Desert" },
  backwaters: { icon: "boat", ink: "#2f6a4a", tint: "#e0eee4", value: "₹12", name: "Backwaters" },
  lighthouse: { icon: "lighthouse", ink: "#9a3a32", tint: "#f6e2de", value: "₹8", name: "Lighthouse" },
  lotus: { icon: "lotus", ink: "#8a3a6a", tint: "#f3e2ec", value: "₹7", name: "Lotus" },
  rail: { icon: "train", ink: "#3a3a4a", tint: "#e8e8ee", value: "₹6", name: "By rail" },
  airmail: { icon: "plane", ink: "#2f5fa7", tint: "#e3eaf6", value: "₹30", name: "Airmail" },
  chai: { icon: "cup", ink: "#7a4a2a", tint: "#f2e6da", value: "₹2", name: "Chai" },
  cards: { icon: "cards", ink: "#1f5a3e", tint: "#dfece3", value: "₹50", name: "Card night" },
  night: { icon: "moon", ink: "#2a2f5a", tint: "#e4e5f2", value: "₹4", name: "Night sky" },
  love: { icon: "heart", ink: "#a3323a", tint: "#f7e0e0", value: "₹1", name: "With love" },
  temple: { icon: "temple", ink: "#8a5a1a", tint: "#f4e9d6", value: "₹20", name: "Temple" },
  tea: { icon: "tea", ink: "#3a6a3a", tint: "#e2eedf", value: "₹9", name: "Tea country" },
  seaside: { icon: "wave", ink: "#2a6a8a", tint: "#dfeaf2", value: "₹5", name: "Seaside" },
  home: { icon: "home", ink: "#6a4a3a", tint: "#f0e6de", value: "₹3", name: "Home" },
};
export const THEME_STAMP_IDS = Object.keys(THEMES).map((t) => `t:${t}`);
export const COUNTRY_STAMP_IDS = Object.keys(COUNTRY).map((c) => `c:${c}`);

// "c:TH" (a country) or "t:beach" (a theme). Any country without a drawn landmark still gets a stamp:
// an airmail plane, its name and a value.
export function stampDef(id: string, year = new Date().getFullYear()): StampDef & { year?: number } {
  if (id.startsWith("c:")) {
    const code = id.slice(2).toUpperCase();
    const name = countryOf(code)?.name ?? code;
    const short = name.length > 14 ? code : name;
    const d = COUNTRY[code] ?? { icon: "plane", ink: "#2f4f6f", tint: "#e4e9ef", value: "AIR" };
    return { ...d, name: short, year };
  }
  return THEMES[id.slice(2)] ?? THEMES.airmail;
}
export const isStampId = (id: string) => /^c:[A-Z]{2}$/.test(id) || (id.startsWith("t:") && id.slice(2) in THEMES);

// The stamp as a standalone SVG (76×92): perforated edge, tinted paper, ink frame, landmark, value, name.
export function stampSvg(id: string, k = "s"): string {
  const d = stampDef(id);
  const m = `m${k.replace(/[^a-z0-9]/gi, "")}`;
  const holes: string[] = [];
  for (let x = 4; x <= 72; x += 8) holes.push(`<circle cx="${x}" cy="0" r="2.6"/><circle cx="${x}" cy="92" r="2.6"/>`);
  for (let y = 4; y <= 88; y += 8) holes.push(`<circle cx="0" cy="${y}" r="2.6"/><circle cx="76" cy="${y}" r="2.6"/>`);
  const icon = (ICONS as Record<string, string>)[d.icon] ?? ICONS.plane;
  const art = icon.replaceAll("var(--ink)", d.ink).replaceAll("var(--tint)", d.tint);
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 76 92" width="76" height="92"><defs><mask id="${m}"><rect width="76" height="92" fill="#fff"/><g fill="#000">${holes.join("")}</g></mask></defs><g mask="url(#${m})"><rect width="76" height="92" fill="#fbf8f1"/><rect x="6" y="6" width="64" height="80" fill="${d.tint}" stroke="${d.ink}" stroke-width="1"/><g transform="translate(0 6)">${art}</g><text x="66" y="17" text-anchor="end" font-family="Georgia, 'Times New Roman', serif" font-size="11" font-weight="700" fill="${d.ink}">${esc(d.value)}</text><text x="38" y="82" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="6.2" letter-spacing="1.3" font-weight="700" fill="${d.ink}">${esc(d.name.toUpperCase())}</text>${d.year ? `<text x="10" y="17" font-family="Georgia, serif" font-size="6" fill="${d.ink}" opacity=".8">${d.year}</text>` : ""}</g></svg>`;
}

// The round postmark: the place around the edge, the date in the middle.
export function postmarkSvg(place: string, date: string, k = "p"): string {
  const pid = `pm${k.replace(/[^a-z0-9]/gi, "")}`;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 84" width="84" height="84"><circle cx="42" cy="42" r="36" fill="none" stroke="#3a3540" stroke-width="1.6"/><circle cx="42" cy="42" r="27" fill="none" stroke="#3a3540" stroke-width="1"/><defs><path id="${pid}" d="M14 42 a28 28 0 1 1 56 0"/></defs><text font-family="Arial, Helvetica, sans-serif" font-size="8.5" font-weight="700" letter-spacing="2.2" fill="#3a3540"><textPath href="#${pid}" startOffset="50%" text-anchor="middle">${esc(place.toUpperCase().slice(0, 18))}</textPath></text><text x="42" y="46" text-anchor="middle" font-family="Georgia, serif" font-size="9.5" font-weight="700" fill="#3a3540">${esc(date)}</text><text x="42" y="61" text-anchor="middle" font-family="Arial, sans-serif" font-size="6.5" letter-spacing="2" fill="#3a3540">LOOPIN</text></svg>`;
}

export const WAVES_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 50" width="200" height="50">${[0, 1, 2, 3]
  .map((k) => `<path d="M0 ${8 + k * 11} q12.5 -8 25 0 t25 0 t25 0 t25 0 t25 0 t25 0 t25 0 t25 0" stroke="#3a3540" stroke-width="1.6" fill="none"/>`)
  .join("")}</svg>`;

// Photos from Loopin's own picture set (public/photos/…): the only outside pictures a front may use.
export const isSitePhoto = (src: string) => /^\/photos\/[a-z0-9-]+\.jpg$/.test(src);

export function postDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: tz }).format(d).toUpperCase();
}
