import { ImageResponse } from "next/og";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { todayKey } from "@/lib/dates";
import { countdownWords, placeOf, tripEmoji, tripPhase } from "@/lib/countdown";
import { photoData } from "@/lib/share-photo";

// The countdown as a story-sized picture (1080 × 1920) for WhatsApp status or
// Instagram: the trip's photo as a polaroid, the big number, and who's going.
// Only for people in the group (it shows the group's photo and names).
export const dynamic = "force-dynamic";

const size = { width: 1080, height: 1920 };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const myId = await getMyMemberId(id);
  const group = myId ? await db.group.findUnique({ where: { id }, include: { members: { where: { leftAt: null }, select: { id: true, name: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } }) : null;
  if (!group || group.deletedAt || !group.members.some((m) => m.id === myId)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const phase = tripPhase(group.tripStart, group.tripEnd, todayKey(new Date(), await getTimeZone()));
  const words = phase ? countdownWords(group.name, phase) : null;
  if (!phase || !words) return new Response("No countdown", { status: 404, headers: { "Cache-Control": "private, no-store" } });

  const photo = await photoData(group, new URL(req.url).origin);
  const names = group.members.map((m) => m.name.split(" ")[0]);
  // Everyone going (a big group wraps onto a few lines; only past 16 people is the rest counted).
  // Everyone going, each as a little name tag (a very big group wraps onto more rows).
  const shown = names.slice(0, 18);
  const small = names.length > 8;
  const TAG = ["#6fe3a8", "#ffab6b", "#7cc4ff", "#ff8fc7", "#b79cff", "#ffd66b"];
  const hot = phase.kind !== "before" || phase.days <= 7;
  const sub = phase.kind === "before" ? `${words.small} · ${placeOf(group.name)}` : words.small;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "120px 90px 110px",
          color: "#f4f2ec",
          background: "radial-gradient(90% 60% at 80% 10%, #4a3020 0%, #121014 70%)",
        }}
      >
        <div style={{ fontSize: 34, letterSpacing: 12, color: "#a9a395" }}>BOARDING SOON</div>
        {/* The polaroid */}
        <div style={{ marginTop: 70, display: "flex", flexDirection: "column", background: "#f4f1e8", padding: "22px 22px 0", transform: "rotate(-3deg)", boxShadow: "0 40px 80px rgba(0,0,0,0.6)" }}>
          <div style={{ width: 720, height: 620, display: "flex", overflow: "hidden", background: "linear-gradient(160deg, #2c4a52 0%, #d9895a 100%)" }}>
            {photo ? (
              <img src={photo} width={720} height={620} style={{ objectFit: "cover" }} alt="" />
            ) : (
              // No photo to use: a sunset sky with the trip's emoji, big.
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 260, background: "linear-gradient(180deg, #2b2340 0%, #8a4b5e 55%, #e9925f 100%)" }}>
                {tripEmoji(group.name)}
              </div>
            )}
          </div>
          <div style={{ display: "flex", padding: "18px 6px 30px", fontSize: 56, color: "#26231d" }}>{group.name.slice(0, 28)}</div>
        </div>
        {/* The count */}
        <div style={{ marginTop: 90, display: "flex", fontSize: words.big.length > 3 ? 190 : 300, fontWeight: 700, lineHeight: 1, color: hot ? "#ffab6b" : "#6fe3a8", letterSpacing: -8 }}>{words.big}</div>
        <div style={{ marginTop: 20, display: "flex", fontSize: 64, color: "#f4f2ec" }}>{sub}</div>
        <div style={{ marginTop: 34, display: "flex", flexWrap: "wrap", justifyContent: "center", maxWidth: 920, gap: small ? 12 : 16 }}>
          {shown.map((n, i) => (
            <div
              key={`${n}-${i}`}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: small ? "8px 20px 8px 8px" : "10px 26px 10px 10px", borderRadius: 999, background: "rgba(244,242,236,0.08)", border: "2px solid rgba(244,242,236,0.14)" }}
            >
              <div style={{ width: small ? 40 : 50, height: small ? 40 : 50, borderRadius: 999, background: TAG[i % TAG.length], color: "#121014", display: "flex", alignItems: "center", justifyContent: "center", fontSize: small ? 22 : 27, fontWeight: 700 }}>
                {n.charAt(0).toUpperCase()}
              </div>
              <div style={{ display: "flex", fontSize: small ? 30 : 36, color: "#f4f2ec" }}>{n}</div>
            </div>
          ))}
          {names.length > shown.length && <div style={{ display: "flex", alignItems: "center", fontSize: 30, color: "#a9a395" }}>& {names.length - shown.length} more</div>}
        </div>
        <div style={{ marginTop: "auto", display: "flex", fontSize: 32, letterSpacing: 4, color: "#77736a" }}>made with loopin</div>
      </div>
    ),
    // Kept on the phone for a few minutes, so opening Share and tapping WhatsApp is instant.
    { ...size, emoji: "twemoji", headers: { "Cache-Control": "private, max-age=300" } },
  );
}
