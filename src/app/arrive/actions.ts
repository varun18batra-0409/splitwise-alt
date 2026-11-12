"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { redeemMovePass } from "@/lib/move";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";
import { safePath } from "@/lib/paths";

// The tap on "Continue to Loopin": only now is the pass used up and the sign-in set.
// Already signed in here: nothing changes (a pass can never switch who someone is).
export async function confirmArrival(formData: FormData) {
  const to = safePath(String(formData.get("to") ?? ""));
  const jar = await cookies();
  if (jar.get(SESSION_COOKIE)?.value) redirect(to);
  const pass = await redeemMovePass(String(formData.get("t") ?? "")).catch(() => null);
  if (!pass) redirect(`/arrive?${new URLSearchParams({ to, gone: "1" })}`);
  // Same rule as the other sign-in cookies (src/lib/identity.ts): plain http only for the automated browser tests.
  const secure = process.env.NODE_ENV === "production" && process.env.E2E_PLAIN_HTTP !== "1";
  jar.set(SESSION_COOKIE, pass.session, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: SESSION_MAX_AGE });
  if (pass.tourSeen) jar.set("lp_tour", "1", { sameSite: "lax", secure, path: "/", maxAge: 31536000 });
  const dest = new URL(to, "http://loopin.invalid");
  dest.searchParams.set("moved", "1");
  redirect(dest.pathname + dest.search + dest.hash);
}
