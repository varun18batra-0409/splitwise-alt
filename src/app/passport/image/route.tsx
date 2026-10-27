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
  // Up to 14 stamps: the newest Loopin trips first, then "Been there".
  const stamps = [
    ...[...p.stamps].reverse().map((s) => ({ key: s.id, big: s.kind === "country" ? s.flag : s.name, small: s.kind === "country" ? s.name : s.flag, round: s.kind === "country", light: false })),
    ...p.been.map((s) => ({ key: s.id, big: s.flag, small: s.name, round: true, light: true })),
  ].slice(0, 14);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "120px 80px 100px", background: "#1d2a44", color: "#e9dfc4" }}>
        <div style={{ display: "flex", fontSize: 34, letterSpacing: 14, opacity: 0.7 }}>LOOPIN · PASSPORT</div>
        <div style={{ display: "flex", marginTop: 30, fontSize: 96, fontWeight: 700 }}>{(account.name || "My trips").slice(0, 20)}</div>
        <div style={{ display: "flex", marginTop: 20, fontSize: 46, opacity: 0.85 }}>
          {p.stats.countries} {p.stats.countries === 1 ? "country" : "countries"} · {p.stats.cities} {p.stats.cities === 1 ? "city" : "cities"} · {p.stats.trips} {p.stats.trips === 1 ? "trip" : "trips"}
        </div>
        <div style={{ marginTop: 70, display: "flex", flexWrap: "wrap", gap: 34, padding: 50, borderRadius: 36, background: "#efe9da", justifyContent: "center", alignItems: "center", flexGrow: 1 }}>
          {stamps.map((s) => {
            const ink = INKS[hash(s.key) % INKS.length];
            return (
              <div
                key={s.key}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: ink,
                  border: `${s.light ? "5px dashed" : "6px solid"} ${ink}`,
                  borderRadius: s.round ? 999 : 22,
                  width: s.round ? 250 : undefined,
                  height: s.round ? 250 : undefined,
                  padding: s.round ? 0 : "18px 30px",
                  transform: `rotate(${(hash(s.key) % 11) - 5}deg)`,
                  opacity: s.light ? 0.5 : 1,
                }}
              >
                <div style={{ display: "flex", fontSize: s.round ? 90 : 52, fontWeight: 700 }}>{s.big}</div>
                <div style={{ display: "flex", fontSize: s.round ? 34 : 36 }}>{s.small}</div>
              </div>
            );
          })}
          {stamps.length === 0 && <div style={{ display: "flex", fontSize: 56, color: "#5c564a" }}>First stamp coming soon ✈️</div>}
        </div>
        <div style={{ marginTop: 50, display: "flex", fontSize: 32, letterSpacing: 4, color: "#8a8574" }}>made with loopin</div>
      </div>
    ),
    { width: 1080, height: 1920, emoji: "twemoji", headers: { "Cache-Control": "private, max-age=120" } },
  );
}
