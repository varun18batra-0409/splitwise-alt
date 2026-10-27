import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { groupTint, tintStyle } from "@/lib/tint";

// Every screen of a group. A deleted group's screens (reached with the phone's
// back button or swipe after deleting it) go to Home, where it can be restored,
// instead of a "not available" page.
// Each group's screens take the colour of its picture (lib/tint.ts): the page behind
// everything, the cards and the lines, all a deep shade of it.
export default async function GroupLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await db.group.findUnique({ where: { id }, select: { id: true, deletedAt: true, name: true, type: true, cover: true, coverAt: true, tripPlace: true } });
  if (g?.deletedAt) redirect("/?deleted=gone");
  const tint = g ? groupTint(g) : null;
  if (!tint) return children;
  return (
    <div style={tintStyle(tint)} data-tint={tint.hue}>
      {/* The tinted page behind the whole screen (fixed, so it fills past the content too). */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-canvas" />
      {children}
    </div>
  );
}
