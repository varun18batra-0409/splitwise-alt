import { NextResponse, type NextRequest } from "next/server";
import { getAccount } from "@/lib/identity";
import { registrationOptions } from "@/lib/passkeys";
import { ownOrigin } from "@/lib/same-origin";

// Step 1 of turning on fingerprint / face sign-in (signed in only).
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const origin = ownOrigin(req);
  const account = await getAccount();
  if (!origin || !account) return NextResponse.json({ error: "Sign in first." }, { status: 403 });
  const options = await registrationOptions(account.id, origin);
  return options ? NextResponse.json(options) : NextResponse.json({ error: "Not available here." }, { status: 400 });
}
