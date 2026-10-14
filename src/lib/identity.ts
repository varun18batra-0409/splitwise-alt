import { cookies } from "next/headers";

// Remembers, on this phone/browser, which person you are in each group.
// Stored as a small cookie: { "<groupId>": "<memberId>", ... }
const COOKIE = "sw_me";
const FIVE_YEARS = 60 * 60 * 24 * 365 * 5;

export async function getMemberships(): Promise<Record<string, string>> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function getMyMemberId(groupId: string): Promise<string | undefined> {
  return (await getMemberships())[groupId];
}

// Only works inside a server action (form submit).
export async function setMyMemberId(groupId: string, memberId: string) {
  const all = await getMemberships();
  all[groupId] = memberId;
  (await cookies()).set(COOKIE, JSON.stringify(all), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: FIVE_YEARS,
  });
}
