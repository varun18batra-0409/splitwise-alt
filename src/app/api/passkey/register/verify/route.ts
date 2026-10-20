import { NextResponse, type NextRequest } from "next/server";
import { getAccount } from "@/lib/identity";
import { saveRegistration } from "@/lib/passkeys";
import { ownOrigin } from "@/lib/same-origin";

// Step 2: keep the new passkey's public key.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const origin = ownOrigin(req);
  const account = await getAccount();
  if (!origin || !account) return NextResponse.json({ ok: false }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { response?: unknown; label?: string } | null;
  if (!body?.response) return NextResponse.json({ ok: false }, { status: 400 });
  const ok = await saveRegistration(account.id, origin, body.response as never, String(body.label ?? ""));
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
}
