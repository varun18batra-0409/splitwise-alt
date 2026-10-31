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
  { id: "editorial", name: "Editorial", family: "Fraunces" },
  { id: "elegant", name: "Elegant", family: "Cormorant Garamond", italic: true },
  { id: "vogue", name: "Vogue", family: "Bodoni Moda", italic: true },
  { id: "riviera", name: "Riviera", family: "Italiana" },
  { id: "roman", name: "Roman", family: "Cinzel", caps: true },
  { id: "deco", name: "Deco", family: "Josefin Sans", caps: true },
  { id: "condensed", name: "Condensed", family: "Oswald", caps: true },
  { id: "slab", name: "Slab", family: "Alfa Slab One" },
  { id: "retro", name: "Retro", family: "Yeseva One" },
  { id: "typewriter", name: "Typewriter", family: "Special Elite" },
  { id: "script", name: "Script", family: "Great Vibes" },
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
  { id: "indie", family: "Indie Flower", size: 0.95 },
  { id: "shadows", family: "Shadows Into Light", size: 1.02 },
  { id: "gochi", family: "Gochi Hand", size: 0.98 },
  { id: "delafield", family: "Mrs Saint Delafield", size: 1.3 },
  { id: "allura", family: "Allura", size: 1.22 },
  { id: "grace", family: "Covered By Your Grace", size: 1.1 },
];
export const handOf = (id: string) => HANDS.find((h) => h.id === id) ?? HANDS[0];

// Google Fonts for the lettering and handwriting (loaded only on postcard screens).
export const POSTCARD_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Playfair+Display:ital,wght@1,500&family=Bebas+Neue&family=Abril+Fatface&family=Caveat:wght@500&family=Homemade+Apple&family=Kalam&family=Dancing+Script:wght@500&family=Sacramento&family=La+Belle+Aurore&family=Nothing+You+Could+Do&family=Cedarville+Cursive&family=Satisfy&family=Parisienne&family=Reenie+Beanie&family=Patrick+Hand&family=Fraunces:wght@600&family=Cormorant+Garamond:ital,wght@1,500&family=Bodoni+Moda:ital,wght@1,500&family=Italiana&family=Cinzel:wght@600&family=Josefin+Sans:wght@600&family=Oswald:wght@500&family=Alfa+Slab+One&family=Yeseva+One&family=Special+Elite&family=Great+Vibes&family=Indie+Flower&family=Shadows+Into+Light&family=Gochi+Hand&family=Mrs+Saint+Delafield&family=Allura&family=Covered+By+Your+Grace&display=swap";

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


// Extra stamp art for the rare stamps (same 76×80 box as the others).
const MORE_ICONS: Record<string, string> = {
  diya: `<path d="M16 50 q22 20 44 0 Z" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M38 24 q-8 11 0 21 q8 -10 0 -21Z" fill="var(--ink)" opacity=".85"/><path d="M38 33 q-3 5 0 9 q3 -4 0 -9Z" fill="var(--tint)"/><path d="M24 66 h28" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  firework: `<path d="M43.0 36.0 L58.0 36.0 M42.3 38.5 L55.3 46.0 M40.5 40.3 L48.0 53.3 M38.0 41.0 L38.0 56.0 M35.5 40.3 L28.0 53.3 M33.7 38.5 L20.7 46.0 M33.0 36.0 L18.0 36.0 M33.7 33.5 L20.7 26.0 M35.5 31.7 L28.0 18.7 M38.0 31.0 L38.0 16.0 M40.5 31.7 L48.0 18.7 M42.3 33.5 L55.3 26.0" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="38" cy="36" r="2" fill="var(--ink)"/><path d="M61.0 36.0 L63.0 36.0 M57.9 47.5 L59.7 48.5 M49.5 55.9 L50.5 57.7 M38.0 59.0 L38.0 61.0 M26.5 55.9 L25.5 57.7 M18.1 47.5 L16.3 48.5 M15.0 36.0 L13.0 36.0 M18.1 24.5 L16.3 23.5 M26.5 16.1 L25.5 14.3 M38.0 13.0 L38.0 11.0 M49.5 16.1 L50.5 14.3 M57.9 24.5 L59.7 23.5" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M38 60 v10" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  kite: `<path d="M38 14 L56 36 L38 58 L20 36Z M38 14 V58 M20 36 H56" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M38 58 q-6 6 0 10 q6 4 0 9" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M34 63 l3 1 -3 2Z M40 70 l-3 1 3 2Z" fill="var(--ink)"/>`,
  splash: `<circle cx="30" cy="34" r="11" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="46" cy="34" r="11" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="38" cy="48" r="11" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="20" cy="56" r="2" fill="var(--ink)"/><circle cx="58" cy="58" r="2.4" fill="var(--ink)"/><circle cx="56" cy="18" r="1.8" fill="var(--ink)"/><circle cx="18" cy="20" r="1.4" fill="var(--ink)"/>`,
  sun: `<circle cx="38" cy="40" r="11" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M53.0 40.0 L60.0 40.0 M51.0 47.5 L57.1 51.0 M45.5 53.0 L49.0 59.1 M38.0 55.0 L38.0 62.0 M30.5 53.0 L27.0 59.1 M25.0 47.5 L18.9 51.0 M23.0 40.0 L16.0 40.0 M25.0 32.5 L18.9 29.0 M30.5 27.0 L27.0 20.9 M38.0 25.0 L38.0 18.0 M45.5 27.0 L49.0 20.9 M51.0 32.5 L57.1 29.0" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 70 h56" stroke="var(--ink)"/>`,
  umbrella: `<path d="M16 42 q22 -30 44 0 q-5.5 -5 -11 0 q-5.5 -5 -11 0 q-5.5 -5 -11 0 q-5.5 -5 -11 0Z" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M38 42 v20 q0 5 -5 5 q-4 0 -4 -4" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M38 12 v4" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 52 l-2 5 M26 56 l-2 5 M54 52 l-2 5 M60 60 l-2 5" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  star: `<path d="M38.0 18.0 L42.7 31.5 L57.0 31.8 L45.6 40.5 L49.8 54.2 L38.0 46.0 L26.2 54.2 L30.4 40.5 L19.0 31.8 L33.3 31.5Z" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M38 64 v6 M30 70 h16" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M17.0 20.0 L20.0 20.0 M16.0 21.0 L16.0 24.0 M15.0 20.0 L12.0 20.0 M16.0 19.0 L16.0 16.0 M61.0 24.0 L64.0 24.0 M60.0 25.0 L60.0 28.0 M59.0 24.0 L56.0 24.0 M60.0 23.0 L60.0 20.0" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  snowflake: `<path d="M38.0 40.0 L60.0 40.0 M38.0 40.0 L49.0 59.1 M38.0 40.0 L27.0 59.1 M38.0 40.0 L16.0 40.0 M38.0 40.0 L27.0 20.9 M38.0 40.0 L49.0 20.9" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M38 24 l-5 -5 M38 24 l5 -5 M38 56 l-5 5 M38 56 l5 5 M24 32 l-7 -1 M24 32 l-2 -7 M52 48 l7 1 M52 48 l2 7 M52 32 l7 -1 M52 32 l2 -7 M24 48 l-7 1 M24 48 l-2 7" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
};

// ---------- Rare stamps ----------
// Limited issues: each can only be put on a card during its window (month-day, India time), then it's
// gone until next year. Any card you send or get with one adds it to your stamp album.
type Rare = StampDef & { from: string; to: string; when: string };
export const RARE: Record<string, Rare> = {
  newyear: { icon: "firework", ink: "#8a6a1f", tint: "#f5ecd6", value: "₹100", name: "New Year", from: "12-27", to: "01-07", when: "New Year week" },
  kites: { icon: "kite", ink: "#b0402a", tint: "#f8e4da", value: "₹14", name: "Kite day", from: "01-10", to: "01-16", when: "mid January" },
  valentine: { icon: "heart", ink: "#9b2335", tint: "#f6dfe2", value: "₹14", name: "Valentine", from: "02-07", to: "02-15", when: "Valentine’s week" },
  holi: { icon: "splash", ink: "#7a3a8a", tint: "#f1e2f3", value: "₹20", name: "Holi", from: "03-10", to: "03-25", when: "Holi" },
  summer: { icon: "sun", ink: "#b0661a", tint: "#f8ead6", value: "₹12", name: "Summer hols", from: "05-01", to: "06-10", when: "May and early June" },
  monsoon: { icon: "umbrella", ink: "#2a5a7a", tint: "#dde9f0", value: "₹11", name: "Monsoon", from: "07-01", to: "08-31", when: "July and August" },
  diwali: { icon: "diya", ink: "#a5561a", tint: "#f8e7d2", value: "₹51", name: "Diwali", from: "10-25", to: "11-12", when: "Diwali" },
  christmas: { icon: "star", ink: "#1f5a3e", tint: "#dfece3", value: "₹25", name: "Christmas", from: "12-18", to: "12-26", when: "Christmas week" },
  winter: { icon: "snowflake", ink: "#2f4f7a", tint: "#e2e9f3", value: "₹8", name: "Winter", from: "12-01", to: "02-28", when: "December to February" },
};
export const RARE_STAMP_IDS = Object.keys(RARE).map((r) => `r:${r}`);
const mdIn = (tz: string, d: Date) => new Intl.DateTimeFormat("en-CA", { month: "2-digit", day: "2-digit", timeZone: tz }).format(d).replace("/", "-");
export function rareOpen(id: string, now = new Date(), tz = "Asia/Kolkata"): boolean {
  const r = RARE[id.replace(/^r:/, "")];
  if (!r) return false;
  const md = mdIn(tz, now);
  return r.from <= r.to ? md >= r.from && md <= r.to : md >= r.from || md <= r.to;
}
export const openRareStamps = (now = new Date()) => RARE_STAMP_IDS.filter((id) => rareOpen(id, now));
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
  if (id.startsWith("r:") && RARE[id.slice(2)]) return { ...RARE[id.slice(2)], year };
  return THEMES[id.slice(2)] ?? THEMES.airmail;
}
export const isStampId = (id: string) => /^c:[A-Z]{2}$/.test(id) || (id.startsWith("t:") && id.slice(2) in THEMES) || (id.startsWith("r:") && id.slice(2) in RARE);

// The stamp as a standalone SVG (76×92): perforated edge, tinted paper, ink frame, landmark, value, name.
export function stampSvg(id: string, k = "s"): string {
  const d = stampDef(id);
  const m = `m${k.replace(/[^a-z0-9]/gi, "")}`;
  const holes: string[] = [];
  for (let x = 4; x <= 72; x += 8) holes.push(`<circle cx="${x}" cy="0" r="2.6"/><circle cx="${x}" cy="92" r="2.6"/>`);
  for (let y = 4; y <= 88; y += 8) holes.push(`<circle cx="0" cy="${y}" r="2.6"/><circle cx="76" cy="${y}" r="2.6"/>`);
  const icon = ({ ...ICONS, ...MORE_ICONS } as Record<string, string>)[d.icon] ?? ICONS.plane;
  const rare = id.startsWith("r:");
  const art = icon.replaceAll("var(--ink)", d.ink).replaceAll("var(--tint)", d.tint);
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 76 92" width="76" height="92"><defs><mask id="${m}"><rect width="76" height="92" fill="#fff"/><g fill="#000">${holes.join("")}</g></mask></defs><g mask="url(#${m})"><rect width="76" height="92" fill="#fbf8f1"/><rect x="6" y="6" width="64" height="80" fill="${d.tint}" stroke="${d.ink}" stroke-width="1"/>${rare ? `<rect x="8.5" y="8.5" width="59" height="75" fill="none" stroke="#b8913a" stroke-width="1.2"/><rect x="10.5" y="10.5" width="55" height="71" fill="none" stroke="#b8913a" stroke-width=".5"/>` : ""}<g transform="translate(0 6)">${art}</g><text x="66" y="17" text-anchor="end" font-family="Georgia, 'Times New Roman', serif" font-size="11" font-weight="700" fill="${d.ink}">${esc(d.value)}</text><text x="38" y="82" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="6.2" letter-spacing="1.3" font-weight="700" fill="${d.ink}">${esc(d.name.toUpperCase())}</text>${d.year ? `<text x="10" y="17" font-family="Georgia, serif" font-size="6" fill="${d.ink}" opacity=".8">${d.year}</text>` : ""}</g></svg>`;
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
