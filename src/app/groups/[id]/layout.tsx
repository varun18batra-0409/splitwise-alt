import { redirect } from "next/navigation";
import { db } from "@/lib/db";

// Every screen of a group. A deleted group's screens (reached with the phone's
// back button or swipe after deleting it) go to Home, where it can be restored,
// instead of a "not available" page.
export default async function GroupLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await db.group.findUnique({ where: { id }, select: { deletedAt: true } });
  if (g?.deletedAt) redirect("/?deleted=gone");
  return children;
}
