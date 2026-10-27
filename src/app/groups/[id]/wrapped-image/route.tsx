import { ImageResponse } from "next/og";
import { loadGroup } from "@/lib/group-data";
import { getMyMemberId } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { photoData } from "@/lib/share-photo";
import { wrapSlides, type SlideData } from "@/lib/wrapped";

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
  const INK = "#17150f";
  const tile = (bg: string, top: string, big: string, small: string) => (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, background: bg, borderRadius: 34, padding: "30px 30px 34px", color: INK }}>
      <div style={{ display: "flex", fontSize: 30 }}>{top}</div>
      <div style={{ display: "flex", marginTop: 10, fontSize: 52, fontWeight: 700, lineHeight: 1.05 }}>{big}</div>
      <div style={{ display: "flex", marginTop: 8, fontSize: 30 }}>{small}</div>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "100px 70px 80px", color: INK, background: "#ffd66b" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
          <div style={{ display: "flex", background: "#fffdf6", padding: "14px 14px 46px", transform: "rotate(-5deg)", boxShadow: "0 26px 50px rgba(0,0,0,0.3)" }}>
            <div style={{ width: 330, height: 300, display: "flex", overflow: "hidden", background: "#ff9b73" }}>
              {photo ? <img src={photo} width={330} height={300} style={{ objectFit: "cover" }} alt="" /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 140 }}>🎬</div>}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flexShrink: 1 }}>
            <div style={{ display: "flex", fontSize: 76, fontWeight: 700, lineHeight: 1.02 }}>{group.name.slice(0, 22)}</div>
            <div style={{ display: "flex", marginTop: 10, fontSize: 44 }}>wrapped</div>
          </div>
        </div>
        {total && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 70 }}>
            <div style={{ display: "flex", fontSize: 38 }}>Together we spent</div>
            <div style={{ display: "flex", fontSize: total.amount.length > 11 ? 130 : 160, fontWeight: 700, lineHeight: 1, letterSpacing: -4 }}>{total.amount}</div>
            <div style={{ display: "flex", marginTop: 8, fontSize: 40 }}>About {total.each} each</div>
          </div>
        )}
        <div style={{ display: "flex", gap: 22, marginTop: 56 }}>
          {cat && tile("#ff9b73", `${cat.emoji} Most went on`, `${cat.pct}%`, cat.label.slice(0, 18))}
          {day && tile("#8ccfff", "📅 Biggest day", day.label, day.amount)}
        </div>
        {splurge && <div style={{ display: "flex", marginTop: 22 }}>{tile("#ff9fd0", "🧾 The splurge", splurge.description.slice(0, 26), splurge.amount)}</div>}
        {awards.length > 0 && (
          <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10, padding: "30px 34px", borderRadius: 34, background: "#c3aeff" }}>
            <div style={{ display: "flex", fontSize: 32 }}>🏆 The awards</div>
            {awards.slice(0, 4).map((a) => (
              <div key={a.memberId} style={{ display: "flex", fontSize: 40 }}>
                {a.emoji} {a.title}: {name(a.memberId)}
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: "auto", display: "flex", fontSize: 30, letterSpacing: 4, color: "#17150f99" }}>made with loopin</div>
      </div>
    ),
    { width: 1080, height: 1920, emoji: "twemoji", headers: { "Cache-Control": "private, max-age=300" } },
  );
}
