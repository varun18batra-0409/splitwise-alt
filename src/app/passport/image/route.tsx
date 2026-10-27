import { ImageResponse } from "next/og";
import { headers } from "next/headers";
import { getAccount } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { todayKey } from "@/lib/dates";
import { visitorRegion } from "@/lib/region";
import { countryOf } from "@/lib/geo";
import { loadPassport } from "@/lib/passport-db";

// Your passport as a story-sized picture (1080 × 1920) to show off. Only for
// you (it's your trips): signed-in only, never cached for anyone else.
export const dynamic = "force-dynamic";

const INKS = ["#2b4c7e", "#a53a3a", "#2f7d4f", "#6a3d8f", "#8a5a2b", "#1f6f78"];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export async function GET() {
  const account = await getAccount();
  if (!account) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const region = visitorRegion(await headers());
  const p = await loadPassport(account, region.country && countryOf(region.country) ? region.country : "", todayKey(new Date(), await getTimeZone()));
  // Up to 9 stamps on the open page: the newest Loopin trips first, then "Been there".
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const when = (d: string) => (d ? `${MONTHS[Number(d.slice(5, 7)) - 1] ?? ""} ${d.slice(0, 4)}` : "BEEN THERE");
  const stamps = [...[...p.stamps].reverse(), ...p.been].slice(0, 9);
  const name = (account.name || "Traveller").slice(0, 22);
  const GOLD = "#d8bd7a";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", padding: "90px 70px 80px", background: "radial-gradient(120% 60% at 50% 0%, #22304f 0%, #111522 65%)", color: "#efe6cc" }}>
        {/* The cover, folded open at the top. */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", padding: "46px 40px 40px", borderRadius: 36, background: "#1d2a44", border: `3px solid ${GOLD}55`, boxShadow: "0 30px 60px rgba(0,0,0,0.5)" }}>
          <div style={{ display: "flex", fontSize: 30, letterSpacing: 16, color: GOLD }}>LOOPIN</div>
          <div style={{ display: "flex", width: 120, height: 120, marginTop: 26, borderRadius: 999, border: `4px solid ${GOLD}`, alignItems: "center", justifyContent: "center", fontSize: 60, fontWeight: 700, color: GOLD }}>L</div>
          <div style={{ display: "flex", marginTop: 26, fontSize: 64, letterSpacing: 18, color: GOLD, fontWeight: 700 }}>PASSPORT</div>
          <div style={{ display: "flex", marginTop: 14, fontSize: 44, color: "#efe6cc" }}>{name}</div>
          <div style={{ display: "flex", marginTop: 18, fontSize: 36, color: "#efe6ccbb" }}>
            {p.stats.countries} {p.stats.countries === 1 ? "country" : "countries"} · {p.stats.cities} {p.stats.cities === 1 ? "city" : "cities"} · {p.stats.trips} {p.stats.trips === 1 ? "trip" : "trips"}
          </div>
        </div>
        {/* The open page with the stamps. */}
        <div style={{ position: "relative", display: "flex", width: "100%", height: 980, marginTop: 44, borderRadius: 30, background: "#efe8d6", transform: "rotate(-1.5deg)", boxShadow: "0 30px 60px rgba(0,0,0,0.55)" }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 40, display: "flex", background: "linear-gradient(90deg, rgba(0,0,0,0.18), rgba(0,0,0,0))", borderRadius: 30 }} />
          <div style={{ position: "absolute", left: 50, top: 34, display: "flex", fontSize: 26, letterSpacing: 8, color: "#8a8270" }}>VISAS · STAMPS</div>
          {stamps.map((s, i) => {
            const h = hash(s.id);
            const ink = INKS[hash(s.code + s.name) % INKS.length];
            const col = i % 3;
            const row = Math.floor(i / 3);
            const cx = 160 + col * 310 + ((h >> 3) % 50) - 25;
            const cy = 210 + row * 290 + ((h >> 7) % 40) - 20;
            const tilt = (h % 17) - 8;
            const round = s.kind === "country";
            const w = round ? 250 : 270;
            const ht = round ? 250 : 150;
            return (
              <div
                key={s.id}
                style={{
                  position: "absolute",
                  left: cx - w / 2,
                  top: cy - ht / 2,
                  width: w,
                  height: ht,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: ink,
                  border: `${s.byHand ? "5px dashed" : "6px solid"} ${ink}`,
                  borderRadius: round ? 999 : 18,
                  transform: `rotate(${tilt}deg)`,
                  opacity: s.byHand ? 0.55 : 0.92,
                }}
              >
                {round && <div style={{ display: "flex", fontSize: 70 }}>{s.flag}</div>}
                {!round && <div style={{ display: "flex", fontSize: 20, letterSpacing: 5 }}>ARRIVED</div>}
                <div style={{ display: "flex", fontSize: s.name.length > 12 ? 28 : 36, fontWeight: 700, maxWidth: w - 40, textAlign: "center", justifyContent: "center" }}>{s.name.slice(0, 22)}</div>
                <div style={{ display: "flex", fontSize: 20, letterSpacing: 4, marginTop: 4 }}>{when(s.when)}</div>
              </div>
            );
          })}
          {stamps.length === 0 && <div style={{ display: "flex", margin: "auto", fontSize: 52, color: "#5c564a" }}>First stamp coming soon ✈️</div>}
        </div>
        {p.milestones.length > 0 && (
          <div style={{ display: "flex", gap: 16, marginTop: 44, flexWrap: "wrap", justifyContent: "center" }}>
            {p.milestones.slice(0, 3).map((m) => (
              <div key={m} style={{ display: "flex", padding: "12px 26px", borderRadius: 999, border: `2px solid ${GOLD}88`, fontSize: 30, color: GOLD }}>
                {m}
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: "auto", display: "flex", fontSize: 30, letterSpacing: 4, color: "#8a8574" }}>made with loopin · loopinapps.com</div>
      </div>
    ),
    { width: 1080, height: 1920, emoji: "twemoji", headers: { "Cache-Control": "private, max-age=120" } },
  );
}
