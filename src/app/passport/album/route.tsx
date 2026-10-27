import { ImageResponse } from "next/og";
import { headers } from "next/headers";
import { getAccount } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { todayKey } from "@/lib/dates";
import { visitorRegion } from "@/lib/region";
import { countryOf } from "@/lib/geo";
import { loadPassport } from "@/lib/passport-db";
import { albumStampPages, type Stamp } from "@/lib/passport";
import { loadOgFonts, worldMapImage } from "@/lib/og-assets";

// Your passport as a booklet of pictures for WhatsApp (sent together, they
// arrive as an album): ?page=0 the cover, 1 your details page with the map and
// badges, 2… the stamp pages, six stamps a page. 1080 × 1350 each. Only for you.
export const dynamic = "force-dynamic";

const W = 1080;
const H = 1350;
const INKS = ["#2b4c7e", "#a53a3a", "#2f7d4f", "#6a3d8f", "#8a5a2b", "#1f6f78"];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const month = (d: string) => (/^\d{4}-\d{2}/.test(d) ? `${MONTHS[Number(d.slice(5, 7)) - 1] ?? ""} ${d.slice(0, 4)}` : "");
const FOIL = "#ece8dc";
const GREEN = "#6fe3a8";
const PAPER = "#efe8d6";
const INKTEXT = "#26231d";
const MUTED = "#8a8270";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Paper with faint security print, like a real passport page.
const paper = {
  backgroundColor: PAPER,
  backgroundImage:
    "radial-gradient(circle at 50% 118%, rgba(43,76,126,0) 0%, rgba(43,76,126,0) 38%, rgba(43,76,126,0.07) 38.4%, rgba(43,76,126,0) 39%, rgba(43,76,126,0) 45%, rgba(43,76,126,0.06) 45.4%, rgba(43,76,126,0) 46%), repeating-linear-gradient(115deg, rgba(38,35,29,0.035) 0px, rgba(38,35,29,0.035) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 8px)",
};

function Emblem({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" stroke={FOIL} strokeWidth="1.4">
      <circle cx="50" cy="50" r="44" />
      <circle cx="50" cy="50" r="36" strokeDasharray="1.5 3" />
      <path d="M50 10 L57 50 L50 90 L43 50 Z" fill={FOIL} fillOpacity="0.9" />
      <path d="M50 10 L57 50 L43 50 Z" fill={GREEN} />
      <path d="M10 50 L50 43 L90 50 L50 57 Z" fill={FOIL} fillOpacity="0.45" />
      <circle cx="50" cy="50" r="4" fill="#16161a" />
    </svg>
  );
}

// A stamp, drawn big: a double ring (abroad / been there) or an ARRIVED box (a city at home).
function BigStamp({ s, size }: { s: Stamp; size: number }) {
  const h = hash(s.id);
  const ink = INKS[hash(s.code + s.name) % INKS.length];
  const tilt = (h % 17) - 8;
  const round = s.kind === "country";
  const line = s.byHand ? "dashed" : "solid";
  const label = s.name.length > 14 ? `${s.name.slice(0, 13)}…` : s.name;
  const w = round ? size : Math.round(size * 1.18);
  const ht = round ? size : Math.round(size * 0.74);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: w,
        height: ht,
        color: ink,
        border: `5px ${line} ${ink}`,
        borderRadius: round ? 999 : 18,
        transform: `rotate(${tilt}deg)`,
        opacity: s.byHand ? 0.66 : 0.94,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "87%",
          height: "84%",
          borderRadius: round ? 999 : 10,
          border: `2px ${line} ${ink}`,
        }}
      >
        <div style={{ display: "flex", fontSize: Math.round(size * 0.07), letterSpacing: 4, fontWeight: 700 }}>{s.byHand ? "BEEN THERE" : round ? "VISITED" : "ARRIVED"}</div>
        {round && <div style={{ display: "flex", marginTop: 4, fontSize: Math.round(size * 0.22) }}>{s.flag}</div>}
        <div style={{ display: "flex", marginTop: 2, fontSize: Math.round(size * (label.length > 10 ? 0.105 : 0.13)), fontWeight: 700, fontFamily: "Display", textAlign: "center" }}>{label.toUpperCase()}</div>
        {!s.byHand && <div style={{ display: "flex", marginTop: 2, fontSize: Math.round(size * 0.068), letterSpacing: 3, fontWeight: 700 }}>{month(s.when)}</div>}
      </div>
    </div>
  );
}

function Folio({ n, of, dark }: { n: number; of: number; dark?: boolean }) {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 44, display: "flex", justifyContent: "space-between", padding: "0 70px", fontSize: 24, letterSpacing: 4, color: dark ? `${FOIL}88` : MUTED }}>
      <span>LOOPINAPPS.COM</span>
      <span>
        {n} / {of}
      </span>
    </div>
  );
}

export async function GET(req: Request) {
  const account = await getAccount();
  const noStore = { "Cache-Control": "private, no-store" };
  if (!account) return new Response("Not found", { status: 404, headers: noStore });
  const url = new URL(req.url);
  const origin = url.origin;
  const region = visitorRegion(await headers());
  const p = await loadPassport(account, region.country && countryOf(region.country) ? region.country : "", todayKey(new Date(), await getTimeZone()));
  const name = (account.name || "Traveller").trim().split(/\s+/)[0].slice(0, 18);
  const all = [...[...p.stamps].reverse(), ...p.been];
  const pages = albumStampPages(all.length);
  const total = 2 + pages;
  const n = Math.max(0, Math.min(total - 1, Number(url.searchParams.get("page") ?? 0) || 0));
  const fonts = await loadOgFonts(origin);
  const opts = { width: W, height: H, emoji: "twemoji" as const, fonts: fonts.length ? fonts : undefined, headers: { "Cache-Control": "private, max-age=120" } };
  const sans = fonts.some((f) => f.name === "Sans") ? "Sans" : undefined;

  // The cover.
  if (n === 0) {
    return new ImageResponse(
      (
        <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "radial-gradient(120% 75% at 50% 0%, #2a2a31 0%, #16161a 55%, #0d0d0f 100%)", color: FOIL, fontFamily: sans }}>
          <div style={{ position: "absolute", left: 46, top: 46, right: 46, bottom: 46, display: "flex", borderRadius: 34, border: `2px solid ${FOIL}2e` }} />
          <div style={{ display: "flex", fontSize: 34, letterSpacing: 26, color: `${FOIL}cc` }}>LOOPIN</div>
          <div style={{ display: "flex", marginTop: 70 }}>
            <Emblem size={290} />
          </div>
          <div style={{ display: "flex", marginTop: 80, fontSize: 104, letterSpacing: 30, fontFamily: "Display", fontWeight: 600 }}>PASSPORT</div>
          <div style={{ display: "flex", width: 150, height: 5, marginTop: 34, borderRadius: 5, background: GREEN }} />
          <div style={{ display: "flex", marginTop: 34, fontSize: 52, fontFamily: "Display", fontWeight: 600, color: `${FOIL}ee` }}>{name}</div>
          <div style={{ position: "absolute", bottom: 96, display: "flex", fontSize: 24, letterSpacing: 8, color: `${FOIL}77` }}>{total > 2 ? `${total} PAGES · SWIPE THROUGH` : "LOOPINAPPS.COM"}</div>
        </div>
      ),
      opts,
    );
  }

  // The details page: who, how many, the map, the badges.
  if (n === 1) {
    const mapSrc = await worldMapImage(origin, p.index.filter((r) => r.trips > 0).map((r) => r.code), p.index.filter((r) => r.trips === 0).map((r) => r.code));
    const places = [p.stats.countries ? plural(p.stats.countries, "country", "countries") : "", p.stats.cities ? plural(p.stats.cities, "city", "cities") : ""].filter(Boolean).join(" · ") || "First stamp coming soon";
    const trips = p.stats.trips ? `${plural(p.stats.trips, "trip", "trips")} with Loopin${p.stats.thisYear ? ` · ${p.stats.thisYear} this year` : ""}` : "";
    const badges = p.badges.filter((b) => b.earned).slice(0, 4);
    const mrz1 = `P<LOOPIN<<${name.toUpperCase().replace(/[^A-Z]+/g, "<")}`.padEnd(40, "<").slice(0, 40);
    const mrz2 = `${String(p.stats.countries).padStart(2, "0")}C${String(p.stats.cities).padStart(3, "0")}T${String(p.stats.trips).padStart(3, "0")}`.padEnd(40, "<").slice(0, 40);
    return new ImageResponse(
      (
        <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "70px 70px 0", color: INKTEXT, fontFamily: sans, ...paper }}>
          <div style={{ display: "flex", fontSize: 24, letterSpacing: 7, color: MUTED, fontWeight: 700 }}>LOOPIN · TRAVEL DOCUMENT</div>
          <div style={{ display: "flex", marginTop: 34, gap: 40 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 200, height: 250, borderRadius: 12, border: "2px solid #cfc6b1", background: "#e4dcc6", fontSize: 110, fontFamily: "Display", fontWeight: 600, color: "#5c564a" }}>
              {(name[0] ?? "Y").toUpperCase()}
            </div>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 22 }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 22, color: MUTED }}>Name</span>
                <span style={{ fontSize: 56, fontFamily: "Display", fontWeight: 600, lineHeight: 1.05 }}>{name}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 22, color: MUTED }}>Places</span>
                <span style={{ fontSize: 34, fontWeight: 700 }}>{places}</span>
              </div>
              {trips && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 22, color: MUTED }}>Trips</span>
                  <span style={{ fontSize: 34, fontWeight: 700 }}>{trips}</span>
                </div>
              )}
            </div>
          </div>
          {mapSrc && (
            <div style={{ display: "flex", marginTop: 44, padding: 18, borderRadius: 24, background: "#e9e1cc", border: "2px solid #ddd3bb" }}>
              <img src={mapSrc} width={904} height={452} style={{ width: 904, height: 452 }} alt="" />
            </div>
          )}
          {badges.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 34 }}>
              {badges.map((b) => (
                <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 24px", borderRadius: 999, border: "2px solid #2b4c7e55", color: "#2b4c7e", fontSize: 28, fontWeight: 700 }}>
                  <span>{b.emoji}</span>
                  <span>{b.title}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ position: "absolute", left: 70, right: 70, bottom: 110, display: "flex", flexDirection: "column", fontSize: 30, letterSpacing: 6, color: "#6d6656", fontFamily: "monospace" }}>
            <span>{mrz1}</span>
            <span>{mrz2}</span>
          </div>
          <Folio n={2} of={total} />
        </div>
      ),
      opts,
    );
  }

  // A page of stamps, six to a page (the last says "+N more" if there are lots).
  const k = n - 2;
  const per = 6;
  const last = k === pages - 1;
  const slice = all.slice(k * per, (k + 1) * per);
  const more = last ? all.length - (k + 1) * per : 0;
  const shown = more > 0 ? slice.slice(0, per - 1) : slice;
  const before = shown.length > 0 && shown.every((s) => s.byHand);
  return new ImageResponse(
    (
      <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "70px 60px 0", color: INKTEXT, fontFamily: sans, ...paper }}>
        <div style={{ display: "flex", fontSize: 24, letterSpacing: 7, color: MUTED, fontWeight: 700, paddingLeft: 10 }}>{before ? "BEFORE LOOPIN" : "VISAS · STAMPS"}</div>
        <div style={{ display: "flex", flexWrap: "wrap", marginTop: 20 }}>
          {shown.map((s, i) => (
            <div key={`${s.id}-${i}`} style={{ display: "flex", width: 480, height: 360, alignItems: "center", justifyContent: "center", paddingTop: (hash(s.id) >>> 4) % 30, paddingLeft: (hash(s.id) >>> 9) % 40, paddingRight: 40 - ((hash(s.id) >>> 9) % 40) }}>
              <BigStamp s={s} size={290} />
            </div>
          ))}
          {more > 0 && (
            <div style={{ display: "flex", flexDirection: "column", width: 480, height: 360, alignItems: "center", justifyContent: "center", color: "#5c564a" }}>
              <span style={{ fontSize: 88, fontFamily: "Display", fontWeight: 600 }}>+{more}</span>
              <span style={{ fontSize: 28, letterSpacing: 4 }}>MORE IN LOOPIN</span>
            </div>
          )}
        </div>
        <Folio n={n + 1} of={total} />
      </div>
    ),
    opts,
  );
}
