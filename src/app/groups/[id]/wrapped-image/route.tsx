import { ImageResponse } from "next/og";
import { loadGroup } from "@/lib/group-data";
import { getMyMemberId } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { photoData } from "@/lib/share-photo";
import { wrapSlides } from "@/lib/wrapped";

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
  const pick = (k: string) => slides.find((s) => s.kind === k);
  const name = (mid: string) => people.find((p) => p.id === mid)?.name.split(" ")[0] ?? "";
  const lines = [pick("total"), pick("category"), pick("splurge")].filter(Boolean) as { headline: string; emoji?: string }[];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "110px 80px 100px", color: "#f4f2ec", background: "radial-gradient(110% 60% at 80% 0%, #6b3a8a 0%, #0f0a14 70%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
          <div style={{ display: "flex", background: "#f4f1e8", padding: "16px 16px 50px", transform: "rotate(-4deg)", boxShadow: "0 30px 60px rgba(0,0,0,0.6)" }}>
            <div style={{ width: 360, height: 320, display: "flex", overflow: "hidden", background: "linear-gradient(160deg,#6b3a8a,#d9895a)" }}>
              {photo ? <img src={photo} width={360} height={320} style={{ objectFit: "cover" }} alt="" /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 150 }}>🎬</div>}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flexShrink: 1 }}>
            <div style={{ display: "flex", fontSize: 40, color: "#cdb8e0" }}>wrapped</div>
            <div style={{ display: "flex", fontSize: 76, fontWeight: 700, lineHeight: 1.05 }}>{group.name.slice(0, 22)}</div>
          </div>
        </div>
        <div style={{ marginTop: 80, display: "flex", flexDirection: "column", gap: 26 }}>
          {lines.map((l) => (
            <div key={l.headline} style={{ display: "flex", alignItems: "center", gap: 26, fontSize: 52 }}>
              <div style={{ display: "flex", fontSize: 64 }}>{l.emoji}</div>
              <div style={{ display: "flex" }}>{l.headline.slice(0, 34)}</div>
            </div>
          ))}
        </div>
        {awards.length > 0 && (
          <div style={{ marginTop: 70, display: "flex", flexDirection: "column", gap: 20, padding: "40px 46px", borderRadius: 40, background: "rgba(244,242,236,0.07)", border: "3px solid rgba(244,242,236,0.14)" }}>
            <div style={{ display: "flex", fontSize: 40, color: "#ffd9a8" }}>The awards</div>
            {awards.slice(0, 5).map((a) => (
              <div key={a.title} style={{ display: "flex", fontSize: 46 }}>
                {a.emoji} {a.title}: {name(a.memberId)}
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: "auto", display: "flex", fontSize: 32, letterSpacing: 4, color: "#77736a" }}>made with loopin</div>
      </div>
    ),
    { width: 1080, height: 1920, emoji: "twemoji", headers: { "Cache-Control": "private, max-age=300" } },
  );
}
