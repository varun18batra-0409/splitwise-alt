import { ImageResponse } from "next/og";
import { headers } from "next/headers";
import { getAccount } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { todayKey } from "@/lib/dates";
import { visitorRegion } from "@/lib/region";
import { countryOf } from "@/lib/geo";
import { loadPassport } from "@/lib/passport-db";
import { loadOgFonts, worldMapImage } from "@/lib/og-assets";

// Your passport as a story-sized picture (1080 × 1920) for WhatsApp: the
// cover with your name and counts, your world map with the countries inked
// in, every stamp on a passport page, and your badges. Only for you (it's your
// trips): signed-in only, never cached for anyone else.
export const dynamic = "force-dynamic";

const INKS = ["#2b4c7e", "#a53a3a", "#2f7d4f", "#6a3d8f", "#8a5a2b", "#1f6f78"];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const when = (d: string) => (d ? `${MONTHS[Number(d.slice(5, 7)) - 1] ?? ""} ${d.slice(0, 4)}` : "BEEN THERE");
const PAPER = "#efe8d6";
const FOIL = "#ece8dc";
const GREEN = "#6fe3a8";

export async function GET(req: Request) {
  const account = await getAccount();
  if (!account) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const origin = new URL(req.url).origin;
  const region = visitorRegion(await headers());
  const p = await loadPassport(account, region.country && countryOf(region.country) ? region.country : "", todayKey(new Date(), await getTimeZone()));
  const name = (account.name || "Traveller").split(/\s+/)[0].slice(0, 18);
  const [fontList, mapSrc] = await Promise.all([loadOgFonts(origin), worldMapImage(origin, p.index.filter((r) => r.trips > 0).map((r) => r.code), p.index.filter((r) => r.trips === 0).map((r) => r.code))]);
  const display = fontList.some((f) => f.name === "Display") ? "Display" : undefined;
  const sans = fontList.some((f) => f.name === "Sans") ? "Sans" : undefined;

  // Every stamp (newest trips first, then Been there), sized to fit the page.
  const all = [...[...p.stamps].reverse(), ...p.been];
  const W = 880; // the page's inside width
  const H = mapSrc ? 470 : 1000; // room for the stamps
  let cols = all.length <= 6 ? 3 : all.length <= 12 ? 4 : all.length <= 20 ? 5 : 6;
  let cell = Math.floor(W / cols);
  let rows = Math.ceil(all.length / cols);
  while (rows * cell > H && cols < 8) {
    cols++;
    cell = Math.floor(W / cols);
    rows = Math.ceil(all.length / cols);
  }
  const fit = Math.max(1, Math.floor(H / cell) * cols);
  const shown = all.length > fit ? all.slice(0, fit - 1) : all;
  const more = all.length - shown.length;
  const size = Math.min(230, Math.floor(cell * 0.9));

  const stats = [
    [p.stats.countries, p.stats.countries === 1 ? "country" : "countries"],
    [p.stats.cities, p.stats.cities === 1 ? "city" : "cities"],
    [p.stats.trips, p.stats.trips === 1 ? "trip" : "trips"],
  ].filter(([n]) => Number(n) > 0) as [number, string][];
  const badges = p.badges.filter((b) => b.earned).slice(0, 4);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", padding: "80px 70px 70px", background: "radial-gradient(120% 55% at 50% 0%, #22222a 0%, #0d0d0f 70%)", color: FOIL, fontFamily: sans }}>
        {/* The cover line */}
        <div style={{ display: "flex", fontSize: 28, letterSpacing: 18, color: `${FOIL}aa` }}>LOOPIN · PASSPORT</div>
        <div style={{ display: "flex", marginTop: 18, fontSize: 92, fontWeight: 700, fontFamily: display, lineHeight: 1 }}>{name}’s passport</div>
        <div style={{ display: "flex", width: 120, height: 5, marginTop: 26, borderRadius: 5, background: GREEN }} />

        {/* The counts */}
        <div style={{ display: "flex", gap: 22, marginTop: 40 }}>
          {(stats.length ? stats : ([[0, "stamps yet"]] as [number, string][])).map(([n, label]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "22px 40px", borderRadius: 30, background: "#1a1a1f", border: "2px solid #2b2b31" }}>
              <div style={{ display: "flex", fontSize: 84, fontWeight: 700, fontFamily: display, lineHeight: 1 }}>{n}</div>
              <div style={{ display: "flex", marginTop: 6, fontSize: 30, color: `${FOIL}bb` }}>{label}</div>
            </div>
          ))}
        </div>

        {/* The map */}
        {mapSrc && (
          <div style={{ display: "flex", marginTop: 40, padding: 22, borderRadius: 30, background: PAPER }}>
            <img src={mapSrc} width={896} height={448} style={{ width: 896, height: 448 }} alt="" />
          </div>
        )}

        {/* The stamps, on a passport page */}
        <div style={{ position: "relative", display: "flex", flexWrap: "wrap", alignContent: "flex-start", width: "100%", marginTop: 34, padding: "64px 30px 30px", borderRadius: 30, background: PAPER, flexGrow: 1 }}>
          <div style={{ position: "absolute", left: 40, top: 22, display: "flex", fontSize: 24, letterSpacing: 8, color: "#8a8270" }}>VISAS · STAMPS</div>
          {shown.map((s, i) => {
            const h = hash(s.id);
            const ink = INKS[hash(s.code + s.name) % INKS.length];
            const tilt = (h % 15) - 7;
            const round = s.kind === "country";
            const big = Math.round(size * (round ? 1 : 0.62));
            const label = s.name.length > 13 ? `${s.name.slice(0, 12)}…` : s.name;
            return (
              <div key={`${s.id}-${i}`} style={{ display: "flex", width: cell, height: cell, alignItems: "center", justifyContent: "center" }}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    width: round ? size : Math.round(size * 1.05),
                    height: big,
                    color: ink,
                    border: `${Math.max(3, Math.round(size / 45))}px ${s.byHand ? "dashed" : "solid"} ${ink}`,
                    borderRadius: round ? 999 : 16,
                    transform: `rotate(${tilt}deg)`,
                    opacity: s.byHand ? 0.62 : 0.95,
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "86%", height: "86%", borderRadius: round ? 999 : 10, border: `${Math.max(1, Math.round(size / 110))}px ${s.byHand ? "dashed" : "solid"} ${ink}` }}>
                    {round ? <div style={{ display: "flex", fontSize: Math.round(size * 0.24) }}>{s.flag}</div> : <div style={{ display: "flex", fontSize: Math.round(size * 0.075), letterSpacing: 3, fontWeight: 700 }}>ARRIVED</div>}
                    <div style={{ display: "flex", marginTop: 2, fontSize: Math.round(size * (label.length > 9 ? 0.105 : 0.13)), fontWeight: 700, fontFamily: display, textAlign: "center" }}>{label}</div>
                    <div style={{ display: "flex", fontSize: Math.round(size * 0.065), letterSpacing: 2, fontWeight: 700 }}>{when(s.when)}</div>
                  </div>
                </div>
              </div>
            );
          })}
          {more > 0 && (
            <div style={{ display: "flex", width: cell, height: cell, alignItems: "center", justifyContent: "center", fontSize: Math.round(size * 0.18), fontWeight: 700, color: "#5c564a", fontFamily: display }}>+{more}</div>
          )}
          {all.length === 0 && <div style={{ display: "flex", margin: "auto", fontSize: 48, color: "#5c564a" }}>First stamp coming soon ✈️</div>}
        </div>

        {/* Badges */}
        {badges.length > 0 && (
          <div style={{ display: "flex", gap: 14, marginTop: 30 }}>
            {badges.map((b) => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 22px", borderRadius: 999, border: `2px solid ${GREEN}66`, fontSize: 28, color: FOIL }}>
                <span>{b.emoji}</span>
                <span>{b.title}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", marginTop: 34, fontSize: 28, letterSpacing: 3, color: "#8a8574" }}>Make your own passport · loopinapps.com</div>
      </div>
    ),
    { width: 1080, height: 1920, emoji: "twemoji", fonts: fontList.length ? fontList : undefined, headers: { "Cache-Control": "private, max-age=120" } },
  );
}
