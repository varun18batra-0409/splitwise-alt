import { ImageResponse } from "next/og";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { todayKey } from "@/lib/dates";
import { countdownWords, placeOf, tripEmoji, tripPhase } from "@/lib/countdown";
import { coverOf, isPhoto, photoSrc } from "@/lib/covers";

// The countdown as a story-sized picture (1080 × 1920) for WhatsApp status or
// Instagram: the trip's photo as a polaroid, the big number, and who's going.
// Only for people in the group (it shows the group's photo and names).
export const dynamic = "force-dynamic";

const size = { width: 1080, height: 1920 };

async function photoData(group: { id: string; cover: string; type: string; coverAt: Date | null }, origin: string): Promise<string | null> {
  try {
    const kind = coverOf(group);
    if (kind === "own") {
      const p = await db.groupPhoto.findUnique({ where: { groupId: group.id } });
      if (!p || (p.type !== "image/jpeg" && p.type !== "image/png")) return null; // the picture maker reads JPEG and PNG
      return `data:${p.type};base64,${Buffer.from(p.data).toString("base64")}`;
    }
    const src = isPhoto(kind) ? photoSrc(kind) : null;
    if (!src) return null;
    const res = await fetch(new URL(src, origin));
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/image\/(jpeg|png)/.test(type)) return null;
    return `data:${type.split(";")[0]};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

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
  const who = names.length <= 4 ? names.join(" · ") : `${names.slice(0, 3).join(" · ")} + ${names.length - 3} more`;
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
        <div style={{ marginTop: 26, display: "flex", fontSize: 40, color: "#a9a395" }}>{who}</div>
        <div style={{ marginTop: "auto", display: "flex", fontSize: 32, letterSpacing: 4, color: "#77736a" }}>made with loopin</div>
      </div>
    ),
    { ...size, emoji: "twemoji", headers: { "Cache-Control": "private, no-store" } },
  );
}
