import { ImageResponse } from "next/og";
import { db } from "@/lib/db";
import { loadOgFonts } from "@/lib/og-assets";
import { placePhoto } from "@/lib/places";

// The picture WhatsApp shows under an invite link (1200 × 630): an invitation
// card with the group's name, its kind and how many are in. No money, no names.
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const group = await db.group.findUnique({ where: { inviteCode: code }, select: { name: true, type: true, deletedAt: true, tripPlace: true, members: { where: { leftAt: null }, select: { id: true } } } });
  const fonts = await loadOgFonts(new URL(req.url).origin);
  const name = group && !group.deletedAt ? group.name.slice(0, 34) : "a group on Loopin";
  const kind = group?.type === "trip" ? "TRIP" : group?.type === "home" ? "HOME" : group?.type === "couple" ? "COUPLE" : group?.type === "pot" ? "GAME NIGHT" : "GROUP";
  const n = group?.members.length ?? 0;
  const FG = "#f7f4ec";
  // Trips get a real photo of the place behind the invitation.
  const origin = new URL(req.url).origin;
  const photo = group && !group.deletedAt && group.type === "trip" ? placePhoto(`${group.name} ${group.tripPlace ?? ""}`)?.src : undefined;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", padding: 56, background: "radial-gradient(70% 90% at 100% 0%, rgba(216,189,122,0.28), rgba(13,13,15,0) 70%), radial-gradient(60% 80% at 0% 100%, rgba(111,227,168,0.16), rgba(13,13,15,0) 70%), linear-gradient(160deg, #1d1d22 0%, #0d0d0f 80%)", color: FG, fontFamily: "Sans, SansExt" }}>
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${origin}${photo}`} alt="" width={1200} height={630} style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 630, objectFit: "cover" }} />
        )}
        {photo && <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 630, display: "flex", background: "linear-gradient(180deg, rgba(10,10,12,0.25) 0%, rgba(10,10,12,0.55) 55%, rgba(10,10,12,0.88) 100%)" }} />}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "46px 54px", borderRadius: 36, border: "2px solid rgba(236,232,220,0.32)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 44, fontFamily: "Display, SansExt", fontWeight: 700 }}>loopin</span>
            <span style={{ display: "flex", padding: "10px 22px", borderRadius: 999, border: "2px solid rgba(216,189,122,0.6)", color: "#e8d29a", fontSize: 22, letterSpacing: 5, fontWeight: 700 }}>
              {kind}
              {n > 0 ? ` · ${n} IN` : ""}
            </span>
          </div>
          <div style={{ display: "flex", marginTop: "auto", fontSize: 30, letterSpacing: 6, color: "#d8bd7a", fontWeight: 700 }}>YOU’RE INVITED TO</div>
          <div style={{ display: "flex", marginTop: 10, fontSize: name.length > 22 ? 72 : 92, lineHeight: 1.02, fontFamily: "Display, SansExt", fontWeight: 700 }}>{name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 26, fontSize: 28, color: "rgba(247,244,236,0.7)" }}>
            <div style={{ display: "flex", width: 60, height: 5, borderRadius: 5, background: "#6fe3a8" }} />
            Tap to join · split as you go, keep the memories
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, emoji: "twemoji", fonts: fonts.length ? fonts : undefined, headers: { "Cache-Control": "public, max-age=600" } },
  );
}
