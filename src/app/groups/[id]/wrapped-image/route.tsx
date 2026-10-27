import { ImageResponse } from "next/og";
import { loadGroup } from "@/lib/group-data";
import { getMyMemberId } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { photoData } from "@/lib/share-photo";
import { wrapSlides, type SlideData } from "@/lib/wrapped";
import { loadOgFonts } from "@/lib/og-assets";
import { titleIconPath } from "@/components/TitleIcon";

// The Wrapped as one story-sized picture (1080 × 1920): the photo, the total,
// and everyone's award. Only for people in the group.
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const myId = await getMyMemberId(id);
  const data = myId ? await loadGroup(id) : null;
  if (!data || !myId || !data.group.members.some((m) => m.id === myId)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const { group, expenses, transfers } = data;
  const people = group.members.filter((m) => !m.leftAt).map((m) => ({ id: m.id, name: m.name }));
  const { slides, awards } = wrapSlides({ name: group.name, currency: group.currency, tz: await getTimeZone(), people, expenses, tripStart: group.tripStart, tripEnd: group.tripEnd, stillToSettle: transfers.reduce((s, t) => s + t.amount, 0), myId: "" });
  const photo = await photoData(group, new URL(req.url).origin);
  const slideData = <K extends SlideData["kind"]>(k: K) => slides.find((x) => x.data?.kind === k)?.data as Extract<SlideData, { kind: K }> | undefined;
  const total = slideData("total");
  const cat = slideData("category");
  const day = slideData("day");
  const splurge = slideData("splurge");
  const name = (mid: string) => people.find((p) => p.id === mid)?.name.split(" ")[0] ?? "";
  const fonts = await loadOgFonts(new URL(req.url).origin);
  const FG = "#f7f4ec";
  const MUTE = "#f7f4ec99";
  const tile = (accent: string, top: string, big: string, small: string) => (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, borderRadius: 34, padding: "30px 32px 34px", background: "#18181c", border: `2px solid ${accent}55` }}>
      <div style={{ display: "flex", fontSize: 24, letterSpacing: 5, fontWeight: 700, color: accent }}>{top.toUpperCase()}</div>
      <div style={{ display: "flex", marginTop: 12, fontSize: 54, fontWeight: 700, lineHeight: 1.05, fontFamily: "Display" }}>{big}</div>
      <div style={{ display: "flex", marginTop: 8, fontSize: 30, color: MUTE }}>{small}</div>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "100px 70px 80px", color: FG, fontFamily: "Sans", background: "radial-gradient(90% 45% at 90% 0%, rgba(216,189,122,0.22), rgba(13,13,15,0) 70%), radial-gradient(80% 40% at 0% 100%, rgba(111,227,168,0.12), rgba(13,13,15,0) 70%), linear-gradient(170deg, #1a1a1f 0%, #0d0d0f 75%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
          <div style={{ display: "flex", background: "#f4f1e8", padding: "14px 14px 46px", transform: "rotate(-5deg)", boxShadow: "0 26px 50px rgba(0,0,0,0.6)" }}>
            <div style={{ width: 330, height: 300, display: "flex", overflow: "hidden", background: "#24242a" }}>
              {photo ? <img src={photo} width={330} height={300} style={{ objectFit: "cover" }} alt="" /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, fontFamily: "Display", color: "#d8bd7a" }}>Wrapped</div>}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flexShrink: 1 }}>
            <div style={{ display: "flex", fontSize: 24, letterSpacing: 8, color: "#d8bd7a", fontWeight: 700 }}>LOOPIN · WRAPPED</div>
            <div style={{ display: "flex", marginTop: 14, fontSize: 72, fontWeight: 700, lineHeight: 1.02, fontFamily: "Display" }}>{group.name.slice(0, 22)}</div>
          </div>
        </div>
        {total && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 70 }}>
            <div style={{ display: "flex", fontSize: 26, letterSpacing: 6, color: "#d8bd7a", fontWeight: 700 }}>TOGETHER WE SPENT</div>
            <div style={{ display: "flex", marginTop: 8, fontSize: total.amount.length > 11 ? 130 : 160, fontWeight: 700, lineHeight: 1, letterSpacing: -4, fontFamily: "Display" }}>{total.amount}</div>
            <div style={{ display: "flex", marginTop: 12, fontSize: 38, color: MUTE }}>About {total.each} each</div>
          </div>
        )}
        <div style={{ display: "flex", gap: 22, marginTop: 56 }}>
          {cat && tile("#f2a07b", "Most went on", `${cat.pct}%`, cat.label.slice(0, 18))}
          {day && tile("#9cc8ec", "Biggest day", day.label, day.amount)}
        </div>
        {splurge && <div style={{ display: "flex", marginTop: 22 }}>{tile("#e6a7c8", "The splurge", splurge.description.slice(0, 26), splurge.amount)}</div>}
        {awards.length > 0 && (
          <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 16, padding: "30px 34px", borderRadius: 34, background: "#18181c", border: "2px solid #b9a6ef55" }}>
            <div style={{ display: "flex", fontSize: 24, letterSpacing: 5, fontWeight: 700, color: "#b9a6ef" }}>THE AWARDS</div>
            {awards.slice(0, 4).map((a) => (
              <div key={a.memberId} style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 38 }}>
                <svg width="56" height="56" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="22.5" fill="#141417" stroke="#d8bd7a" strokeWidth="1.5" />
                  <g transform="translate(12 12)">
                    <path d={titleIconPath(a.title)} stroke="#b9a6ef" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                </svg>
                <span style={{ fontFamily: "Display", fontWeight: 700 }}>{a.title}</span>
                <span style={{ color: MUTE }}>{name(a.memberId)}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: "auto", display: "flex", fontSize: 26, letterSpacing: 6, color: "#f7f4ec66" }}>MADE WITH LOOPIN · LOOPINAPPS.COM</div>
      </div>
    ),
    { width: 1080, height: 1920, emoji: "twemoji", fonts: fonts.length ? fonts : undefined, headers: { "Cache-Control": "private, max-age=300" } },
  );
}
