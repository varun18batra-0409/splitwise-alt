import { NextResponse, type NextRequest } from "next/server";
import { signInOptions } from "@/lib/passkeys";
import { ownOrigin } from "@/lib/same-origin";
import { allow, clientIp } from "@/lib/rate-limit";

// Step 1 of signing in with fingerprint / face.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const origin = ownOrigin(req);
  if (!origin) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  if (!(await allow(`passkey:${clientIp(req.headers)}`, 60, 3600))) return NextResponse.json({ error: "Too many tries. Wait a few minutes." }, { status: 429 });
  const options = await signInOptions(origin);
  return options ? NextResponse.json(options) : NextResponse.json({ error: "Not available here." }, { status: 400 });
}
