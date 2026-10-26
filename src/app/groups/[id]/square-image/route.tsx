import { ImageResponse } from "next/og";
import { loadGroup } from "@/lib/group-data";
import { getMyMemberId } from "@/lib/identity";
import { formatMoney } from "@/lib/money";
import { photoData } from "@/lib/share-photo";
import { squareNumbers } from "@/lib/square";

// "All square" as a story-sized picture (1080 × 1920) for WhatsApp status or
// Instagram. Only for people in the group (it shows the group's photo and name).
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const myId = await getMyMemberId(id);
  const data = myId ? await loadGroup(id) : null;
  if (!data || !data.group.members.some((m) => m.id === myId)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const { group, expenses, payments } = data;
  const people = group.members.filter((m) => !m.leftAt);
  const n = squareNumbers({ expenses, payments, people: people.length, tripStart: group.tripStart, tripEnd: group.tripEnd });
  const photo = await photoData(group, new URL(req.url).origin);
  const stats: [string, string][] = [
    [formatMoney(n.spent, group.currency), "spent together"],
    [String(n.expenses), n.expenses === 1 ? "expense" : "expenses"],
    [n.days > 1 ? `${n.days} days` : String(people.length), n.days > 1 ? `${people.length} of us` : "of us"],
  ];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", padding: "150px 90px 110px", color: "#f4f2ec", background: "radial-gradient(100% 60% at 20% 0%, #2f8a62 0%, #0c1511 72%)" }}>
        <div style={{ display: "flex", flexDirection: "column", background: "#f4f1e8", padding: "22px 22px 0", transform: "rotate(-3deg)", boxShadow: "0 40px 80px rgba(0,0,0,0.6)" }}>
          <div style={{ width: 700, height: 600, display: "flex", overflow: "hidden", background: "linear-gradient(160deg, #1f6b4a 0%, #6fe3a8 100%)" }}>
            {photo ? <img src={photo} width={700} height={600} style={{ objectFit: "cover" }} alt="" /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 260 }}>🎉</div>}
          </div>
          <div style={{ display: "flex", padding: "18px 6px 30px", fontSize: 56, color: "#26231d" }}>{group.name.slice(0, 28)}</div>
        </div>
        <div style={{ marginTop: 110, display: "flex", fontSize: 150, fontWeight: 700, letterSpacing: -4 }}>All square 🎉</div>
        <div style={{ marginTop: 22, display: "flex", fontSize: 54, color: "#ffd9a8" }}>Nobody owes anybody.</div>
        <div style={{ marginTop: 80, display: "flex", gap: 28 }}>
          {stats.map(([v, l]) => (
            <div key={l} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "26px 34px", borderRadius: 32, border: "3px solid rgba(244,242,236,0.16)", background: "rgba(244,242,236,0.06)" }}>
              <div style={{ display: "flex", fontSize: 52, fontWeight: 700 }}>{v}</div>
              <div style={{ display: "flex", fontSize: 30, color: "#a9a395" }}>{l}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: "auto", display: "flex", fontSize: 32, letterSpacing: 4, color: "#77736a" }}>made with loopin</div>
      </div>
    ),
    { width: 1080, height: 1920, emoji: "twemoji", headers: { "Cache-Control": "private, max-age=300" } },
  );
}
