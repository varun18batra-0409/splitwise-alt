import { ImageResponse } from "next/og";
import { headers } from "next/headers";
import { getAccount } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { todayKey } from "@/lib/dates";
import { visitorRegion } from "@/lib/region";
import { countryOf } from "@/lib/geo";
import { loadPassport } from "@/lib/passport-db";
import type { Stamp } from "@/lib/passport";
import { loadOgFonts, worldMapImage } from "@/lib/og-assets";

// Your passport as ONE picture for WhatsApp: the booklet lying open in its
// dark Loopin cover. The left page has your details, the world map with your
// countries inked in and your badges; the right page has your stamps (as many
// as fit, then "+N more"). 1080 × 1440. Only for you, never cached for others.
export const dynamic = "force-dynamic";

const W = 1080;
const H = 1440;
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
const print = "repeating-linear-gradient(115deg, rgba(38,35,29,0.035) 0px, rgba(38,35,29,0.035) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 8px)";

// One stamp: a double ring (abroad / been there) or an ARRIVED box (a city at home).
function StampMark({ s, size }: { s: Stamp; size: number }) {
  const h = hash(s.id);
  const ink = INKS[hash(s.code + s.name) % INKS.length];
  const tilt = (h % 17) - 8;
  const round = s.kind === "country";
  const line = s.byHand ? "dashed" : "solid";
  const label = s.name.length > 12 ? `${s.name.slice(0, 11)}…` : s.name;
  const w = round ? size : Math.round(size * 1.16);
  const ht = round ? size : Math.round(size * 0.74);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: w, height: ht, color: ink, border: `${Math.max(3, Math.round(size / 40))}px ${line} ${ink}`, borderRadius: round ? 999 : 12, transform: `rotate(${tilt}deg)`, opacity: s.byHand ? 0.68 : 0.95 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "86%", height: "84%", borderRadius: round ? 999 : 8, border: `${Math.max(1, Math.round(size / 100))}px ${line} ${ink}` }}>
        <div style={{ display: "flex", fontSize: Math.max(9, Math.round(size * 0.075)), letterSpacing: 2, fontWeight: 700 }}>{s.byHand ? "BEEN THERE" : round ? "VISITED" : "ARRIVED"}</div>
        {round && <div style={{ display: "flex", marginTop: 2, fontSize: Math.round(size * 0.2) }}>{s.flag}</div>}
        <div style={{ display: "flex", marginTop: 1, fontSize: Math.round(size * (label.length > 9 ? 0.11 : 0.135)), fontWeight: 700, fontFamily: "Display", textAlign: "center" }}>{label.toUpperCase()}</div>
        {!s.byHand && <div style={{ display: "flex", fontSize: Math.max(9, Math.round(size * 0.07)), letterSpacing: 1, fontWeight: 700 }}>{month(s.when)}</div>}
      </div>
    </div>
  );
}

export async function GET(req: Request) {
  const account = await getAccount();
  if (!account) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const origin = new URL(req.url).origin;
  const region = visitorRegion(await headers());
  const p = await loadPassport(account, region.country && countryOf(region.country) ? region.country : "", todayKey(new Date(), await getTimeZone()));
  const name = (account.name || "Traveller").trim().split(/\s+/)[0].slice(0, 18);
  const [fonts, mapSrc] = await Promise.all([loadOgFonts(origin), worldMapImage(origin, p.index.filter((r) => r.trips > 0).map((r) => r.code), p.index.filter((r) => r.trips === 0).map((r) => r.code))]);
  const sans = fonts.some((f) => f.name === "Sans") ? "Sans" : undefined;

  // Every stamp, newest trips first, then Been there; the grid shrinks to fit them all (up to 20, then "+N more").
  const all = [...[...p.stamps].reverse(), ...p.been];
  const PAGE_W = 446;
  const PAGE_H = 940;
  const cols = all.length <= 6 ? 2 : all.length <= 12 ? 3 : 4;
  const rows = Math.max(1, Math.ceil(Math.min(all.length, cols * 5) / cols));
  const cellW = Math.floor(PAGE_W / cols);
  const cellH = Math.min(Math.floor(PAGE_H / Math.max(rows, 3)), Math.round(cellW * 1.25));
  const fit = cols * Math.floor(PAGE_H / cellH);
  const shown = all.length > fit ? all.slice(0, fit - 1) : all;
  const more = all.length - shown.length;
  const size = Math.min(190, Math.floor(Math.min(cellW, cellH) * 0.86));

  const counts = [p.stats.countries ? plural(p.stats.countries, "country", "countries") : "", p.stats.cities ? plural(p.stats.cities, "city", "cities") : "", p.stats.trips ? plural(p.stats.trips, "trip", "trips") : ""].filter(Boolean).join(" · ");
  const badges = p.badges.filter((b) => b.earned).slice(0, 3);
  const mrz1 = `P<LOOPIN<<${name.toUpperCase().replace(/[^A-Z]+/g, "<")}`.padEnd(30, "<").slice(0, 30);
  const mrz2 = `${String(p.stats.countries).padStart(2, "0")}C${String(p.stats.cities).padStart(3, "0")}T${String(p.stats.trips).padStart(3, "0")}`.padEnd(30, "<").slice(0, 30);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", padding: "56px 30px 0", color: FOIL, fontFamily: sans, background: "radial-gradient(110% 60% at 50% 0%, #26262c 0%, #121215 60%, #0b0b0d 100%)" }}>
        <div style={{ display: "flex", fontSize: 24, letterSpacing: 14, color: `${FOIL}99` }}>LOOPIN · PASSPORT</div>
        <div style={{ display: "flex", marginTop: 14, fontSize: 70, fontFamily: "Display", fontWeight: 700, lineHeight: 1 }}>{name}’s passport</div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 18, fontSize: 30, color: `${FOIL}b3` }}>
          <div style={{ display: "flex", width: 46, height: 4, borderRadius: 4, background: GREEN }} />
          {counts || "First stamp coming soon"}
        </div>

        {/* The open booklet: the cover around it, two pages, the spine between. */}
        <div style={{ display: "flex", marginTop: 40, padding: 20, borderRadius: 30, background: "linear-gradient(160deg, #24242a 0%, #141417 100%)", border: `2px solid ${FOIL}33`, boxShadow: "0 40px 80px rgba(0,0,0,0.6)" }}>
          {/* Left page: details, map, badges. */}
          <div style={{ position: "relative", display: "flex", flexDirection: "column", width: 486, height: 1040, padding: "30px 26px", borderRadius: "16px 4px 4px 16px", backgroundColor: PAPER, backgroundImage: `linear-gradient(90deg, rgba(0,0,0,0) 86%, rgba(38,35,29,0.16) 100%), ${print}`, color: INKTEXT }}>
            <div style={{ display: "flex", fontSize: 17, letterSpacing: 4, color: MUTED, fontWeight: 700 }}>LOOPIN · TRAVEL DOCUMENT</div>
            <div style={{ display: "flex", gap: 22, marginTop: 22 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 118, height: 148, borderRadius: 8, border: "2px solid #cfc6b1", background: "#e4dcc6", fontSize: 66, fontFamily: "Display", fontWeight: 600, color: "#5c564a" }}>{(name[0] ?? "Y").toUpperCase()}</div>
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 10, flexShrink: 1 }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 15, color: MUTED }}>Name</span>
                  <span style={{ fontSize: 34, fontFamily: "Display", fontWeight: 600, lineHeight: 1.05 }}>{name}</span>
                </div>
                {p.stats.countries + p.stats.cities > 0 && (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 15, color: MUTED }}>Places</span>
                    <span style={{ fontSize: 21, fontWeight: 700 }}>{[p.stats.countries ? plural(p.stats.countries, "country", "countries") : "", p.stats.cities ? plural(p.stats.cities, "city", "cities") : ""].filter(Boolean).join(", ")}</span>
                  </div>
                )}
                {p.stats.trips > 0 && (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 15, color: MUTED }}>Trips</span>
                    <span style={{ fontSize: 21, fontWeight: 700 }}>{`${plural(p.stats.trips, "trip", "trips")} with Loopin`}</span>
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", marginTop: 26, fontSize: 15, letterSpacing: 4, color: MUTED, fontWeight: 700 }}>WHERE {name.toUpperCase()} HAS BEEN</div>
            {mapSrc ? (
              <div style={{ display: "flex", marginTop: 10, padding: 8, borderRadius: 12, background: "#e9e1cc", border: "2px solid #ddd3bb" }}>
                <img src={mapSrc} width={414} height={207} style={{ width: 414, height: 207 }} alt="" />
              </div>
            ) : (
              <div style={{ display: "flex", marginTop: 10, height: 207 }} />
            )}
            {badges.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
                <span style={{ fontSize: 15, letterSpacing: 4, color: MUTED, fontWeight: 700 }}>BADGES</span>
                {badges.map((b) => (
                  <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderRadius: 999, border: "2px solid #2b4c7e55", color: "#2b4c7e", fontSize: 20, fontWeight: 700 }}>
                    <span>{b.emoji}</span>
                    <span>{b.title}</span>
                    <span style={{ fontWeight: 500, color: MUTED, fontSize: 16 }}>{b.why}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ position: "absolute", left: 26, right: 26, bottom: 28, display: "flex", flexDirection: "column", fontSize: 19, letterSpacing: 3, color: "#6d6656" }}>
              <span>{mrz1}</span>
              <span>{mrz2}</span>
            </div>
          </div>
          {/* The spine. */}
          <div style={{ display: "flex", width: 4, height: 1040, background: "linear-gradient(90deg, #b9b09a, #d9d1bc)" }} />
          {/* Right page: the stamps. */}
          <div style={{ position: "relative", display: "flex", flexDirection: "column", width: 486, height: 1040, padding: "30px 20px", borderRadius: "4px 16px 16px 4px", backgroundColor: PAPER, backgroundImage: `linear-gradient(90deg, rgba(38,35,29,0.18) 0%, rgba(0,0,0,0) 14%), ${print}`, color: INKTEXT }}>
            <div style={{ display: "flex", paddingLeft: 6, fontSize: 17, letterSpacing: 4, color: MUTED, fontWeight: 700 }}>VISAS · STAMPS</div>
            <div style={{ display: "flex", flexWrap: "wrap", marginTop: 14 }}>
              {shown.map((s, i) => (
                <div key={`${s.id}-${i}`} style={{ display: "flex", width: cellW, height: cellH, alignItems: "center", justifyContent: "center" }}>
                  <StampMark s={s} size={size} />
                </div>
              ))}
              {more > 0 && (
                <div style={{ display: "flex", flexDirection: "column", width: cellW, height: cellH, alignItems: "center", justifyContent: "center", color: "#5c564a" }}>
                  <span style={{ fontSize: Math.round(size * 0.34), fontFamily: "Display", fontWeight: 600 }}>+{more}</span>
                  <span style={{ fontSize: 15, letterSpacing: 3 }}>MORE</span>
                </div>
              )}
              {all.length === 0 && <div style={{ display: "flex", width: PAGE_W, marginTop: 300, justifyContent: "center", fontSize: 30, color: "#8a8270", fontFamily: "Display" }}>Your first stamp is coming</div>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 30, fontSize: 24, letterSpacing: 4, color: `${FOIL}80` }}>Make your own passport · loopinapps.com</div>
      </div>
    ),
    { width: W, height: H, emoji: "twemoji", fonts: fonts.length ? fonts : undefined, headers: { "Cache-Control": "private, max-age=120" } },
  );
}
