import { NextResponse, type NextRequest } from "next/server";
import { checkSignIn } from "@/lib/passkeys";
import { parseConfirmed, signInAs } from "@/lib/identity";
import { ownOrigin } from "@/lib/same-origin";

// Step 2: the phone signed the challenge — sign in to that account.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const origin = ownOrigin(req);
  if (!origin) return NextResponse.json({ ok: false }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { response?: unknown; move?: unknown } | null;
  if (!body?.response) return NextResponse.json({ ok: false }, { status: 400 });
  const accountId = await checkSignIn(origin, body.response as never);
  if (!accountId) return NextResponse.json({ ok: false, error: "That didn’t work. Try again, or use Google or your email." }, { status: 401 });
  // Only the groups the person agreed to move on the sign-in screen (none if the screen sent none).
  await signInAs(accountId, { confirmed: parseConfirmed(body.move) });
  return NextResponse.json({ ok: true });
}
