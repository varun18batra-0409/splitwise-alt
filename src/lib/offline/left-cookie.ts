import { cookies } from "next/headers";

// A short-lived note set by the Sign out and Delete account actions themselves, only when the phone asked for its offline data to be
// cleared (a hidden field the confirm button adds). It exists only once the server has FINISHED: the phone reads it through
// /api/offline/me and so settles the sign-out only on the page the sign-out landed on, never on an answer that left before it finished.
export const LEFT_COOKIE = "sw_left";

export async function markLeft(): Promise<void> {
  try {
    (await cookies()).set(LEFT_COOKIE, "1", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && process.env.E2E_PLAIN_HTTP !== "1", path: "/", maxAge: 600 });
  } catch {
    /* outside a request: nothing to set */
  }
}

// Read once, then gone.
export async function takeLeft(): Promise<boolean> {
  const jar = await cookies();
  const had = jar.get(LEFT_COOKIE)?.value === "1";
  if (had) jar.delete(LEFT_COOKIE);
  return had;
}
