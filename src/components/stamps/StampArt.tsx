import type { CSSProperties } from "react";
import type { Stamp } from "@/lib/passport";

// One drawing of a passport stamp, used by the share picture, the book's pages and the Been cards.
// Only plain boxes and text with inline styles (every box is a flex box), so the same code works in the browser and in next/og.
// No green: the inks are blue, red, purple, brown and teal. Hooks for tests: data-stamp, data-country-stamp, data-by-hand.

export const STAMP_INKS = ["#2b4c7e", "#a53a3a", "#6a3d8f", "#8a5a2b", "#1f6f78"];
export const stampHash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
// Written out by hand, so the phone and the server always agree: "2026-05-05" → "MAY 2026".
export const stampMonth = (d: string) => (/^\d{4}-\d{2}/.test(d) ? `${MONTHS[Number(d.slice(5, 7)) - 1] ?? ""} ${d.slice(0, 4)}` : "");
export const stampInk = (code: string, name: string) => STAMP_INKS[stampHash(code + name) % STAMP_INKS.length];
// Between -8 and +8 degrees, the same for the same stamp.
export const stampTilt = (id: string) => (stampHash(id) % 17) - 8;

// The postmark's waves: the same four wavy lines as the postcards' postmark (src/lib/postcards/catalog.ts WAVES_SVG), drawn here
// as a tiny data picture so this file stays light for the phone.
const WAVES = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 50" width="200" height="50">${[0, 1, 2, 3]
  .map((k) => `<path d="M0 ${8 + k * 11} q12.5 -8 25 0 t25 0 t25 0 t25 0 t25 0 t25 0 t25 0 t25 0" stroke="#3a3540" stroke-width="3" fill="none"/>`)
  .join("")}</svg>`;
const WAVES_URI = `data:image/svg+xml;utf8,${encodeURIComponent(WAVES)}`;

function Waves({ width, style }: { width: number; style: CSSProperties }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={WAVES_URI} width={width} height={Math.round(width / 4)} alt="" style={{ position: "absolute", opacity: 0.45, ...style }} />;
}

const flex = (extra: CSSProperties = {}): CSSProperties => ({ display: "flex", ...extra });

type PageProps = {
  variant?: "page";
  s: Stamp;
  size?: number; // the round stamp's width in px (a box stamp is a little wider)
  tilt?: number; // degrees; default from the stamp's id
  font?: string; // the display font's name: the page uses its CSS variable, the share picture its loaded font
};
type CardProps = {
  variant: "card";
  code: string;
  country: string; // "Thailand" (always the country, even for a trip to Goa)
  when: string; // the trip's start day ("" = "BEEN THERE")
  byHand?: boolean;
  tilt?: number;
  scale?: number;
};

export function StampArt(props: PageProps | CardProps) {
  return props.variant === "card" ? <CardStamp {...props} /> : <PageStamp {...props} />;
}

// The rectangle on a Been card: COUNTRY over MON YEAR, on a scrap of stamp paper, with the postmark's waves.
function CardStamp({ code, country, when, byHand = false, tilt = -8, scale = 1 }: CardProps) {
  const ink = stampInk(code, country);
  const name = country.toUpperCase();
  const month = byHand ? "BEEN THERE" : stampMonth(when);
  const long = name.length > 11;
  const w = Math.round(Math.min(124, Math.max(78, name.length * 8.4 + 22)) * scale);
  return (
    <div data-stamp={country} data-country-stamp={code} data-by-hand={byHand ? "1" : "0"} role="img" aria-label={`${country}, ${byHand ? "been there" : month}`} style={flex({ position: "relative", width: w, transform: `rotate(${tilt}deg)`, color: ink, opacity: byHand ? 0.85 : 1 })}>
      <div style={flex({ flexDirection: "column", alignItems: "center", justifyContent: "center", width: "100%", padding: `${Math.round(5 * scale)}px ${Math.round(6 * scale)}px`, backgroundColor: "#efe8d6", border: `${Math.max(1.5, 2 * scale)}px ${byHand ? "dashed" : "solid"} ${ink}`, borderRadius: 4 })}>
        <div style={flex({ fontSize: Math.round((long ? 10 : 12) * scale), fontWeight: 800, letterSpacing: 1.2, lineHeight: 1.15 })}>{name.length > 16 ? `${name.slice(0, 15)}…` : name}</div>
        <div style={flex({ fontSize: Math.round(10 * scale), fontWeight: 700, letterSpacing: 1.4, lineHeight: 1.2 })}>{month}</div>
      </div>
      <Waves width={Math.round(w * 0.62)} style={{ right: -Math.round(w * 0.1), bottom: -Math.round(w * 0.12) }} />
    </div>
  );
}

// One stamp of the book / the share picture: a boxed ARRIVED stamp for a city at home, a round VISITED ring for a country,
// a dashed BEEN THERE ring for a country added by hand. A country's code sits in the middle (a drawn mark, never a flag emoji).
function PageStamp({ s, size = 112, tilt, font = "var(--font-display), serif" }: PageProps) {
  const ink = stampInk(s.code, s.name);
  const turn = tilt ?? stampTilt(s.id);
  const round = s.kind === "country";
  const line = s.byHand ? "dashed" : "solid";
  const label = s.name.length > 12 ? `${s.name.slice(0, 11)}…` : s.name;
  const w = round ? size : Math.round(size * 1.16);
  const ht = round ? size : Math.round(size * 0.72);
  const edge = Math.max(2.5, Math.round(size / 40));
  const hair = Math.max(1, Math.round(size / 100));
  const hooks = { "data-stamp": s.name, "data-by-hand": s.byHand ? "1" : "0", ...(round ? { "data-country-stamp": s.code } : {}) };
  const tiny = Math.max(8, Math.round(size * 0.075));
  return (
    <div {...hooks} role="img" aria-label={`${s.name}, ${s.byHand ? "been there" : stampMonth(s.when)}`} style={flex({ position: "relative", width: w, height: ht, transform: `rotate(${turn}deg)`, color: ink, opacity: s.byHand ? 0.7 : 0.95 })}>
      <div style={flex({ alignItems: "center", justifyContent: "center", width: "100%", height: "100%", border: `${edge}px ${line} ${ink}`, borderRadius: round ? 999 : 10 })}>
        <div style={flex({ flexDirection: "column", alignItems: "center", justifyContent: "center", width: "86%", height: "84%", border: `${hair}px ${line} ${ink}`, borderRadius: round ? 999 : 6 })}>
          <div style={flex({ fontSize: tiny, letterSpacing: 2, fontWeight: 700 })}>{s.byHand ? "BEEN THERE" : round ? "VISITED" : "ARRIVED"}</div>
          {round && <div style={flex({ marginTop: 1, fontSize: Math.round(size * 0.21), fontWeight: 800, letterSpacing: 1, fontFamily: font })}>{s.code.toUpperCase()}</div>}
          <div style={flex({ marginTop: 1, fontSize: Math.round(size * (label.length > 9 ? 0.105 : 0.13)), fontWeight: 700, textAlign: "center", fontFamily: font })}>{label.toUpperCase()}</div>
          {!s.byHand && <div style={flex({ fontSize: Math.max(8, Math.round(size * 0.07)), letterSpacing: 1, fontWeight: 700 })}>{stampMonth(s.when)}</div>}
        </div>
      </div>
      <Waves width={Math.round(w * 0.55)} style={{ right: -Math.round(w * 0.12), bottom: -Math.round(ht * 0.02) }} />
    </div>
  );
}
