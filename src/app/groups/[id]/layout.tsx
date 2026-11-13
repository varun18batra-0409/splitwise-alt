import { redirect } from "next/navigation";
import { db } from "@/lib/db";

// Every screen of a group. A deleted group's screens (reached with the phone's
// back button or swipe after deleting it) go to Your groups (Recently deleted), where it can be restored,
// instead of a "not available" page.
// Every group page is Loopin's one calm page (#0d0d0f): no per-group colour.
export default async function GroupLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await db.group.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
  if (g?.deletedAt) redirect("/groups?deleted=gone");
  return children;
}
