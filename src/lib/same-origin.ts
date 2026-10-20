import type { NextRequest } from "next/server";

// The page's address if this request came from one of our own pages, else
// null (blocks other websites from calling these endpoints).
export function ownOrigin(req: NextRequest): string | null {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return null;
  try {
    return new URL(origin).host === host ? new URL(origin).origin : null;
  } catch {
    return null;
  }
}
