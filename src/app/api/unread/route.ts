import { getMemberships } from "@/lib/identity";
import { countUnread } from "@/lib/group-data";

// The number on the Alerts bell. A plain GET (not a server action) so it never
// holds up the next tap: Next.js runs server actions one at a time in the same
// queue as screen changes.
export const dynamic = "force-dynamic";

export async function GET() {
  let n = 0;
  try {
    n = await countUnread(await getMemberships());
  } catch {}
  return Response.json({ n }, { headers: { "Cache-Control": "private, no-store" } });
}
