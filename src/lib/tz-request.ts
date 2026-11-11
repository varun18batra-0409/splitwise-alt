import { getAccount, getMemberships } from "./identity";
import { saveTimeZone } from "./nudge-zones";
import { allow } from "./rate-limit";

// The logic of POST /api/tz: validation, limits and status codes, kept out of the route so it can be tested.
//   200 saved   400 not a real zone name   429 too many requests   500 a real failure (the phone must not treat it as saved)
export type TzDeps = {
  allow: (key: string, limit: number, seconds: number) => Promise<boolean>;
  account: () => Promise<{ id: string } | null | undefined>;
  memberships: () => Promise<Record<string, string>>;
  save: (tz: unknown, accountId: string | null, memberIds: string[]) => Promise<boolean>;
};

const real: TzDeps = { allow, account: getAccount, memberships: getMemberships, save: saveTimeZone };

export async function handleTimeZone(body: { tz?: unknown } | null, ip: string, deps: TzDeps = real): Promise<{ ok: boolean; status: number }> {
  try {
    // Generous per network address (many phones share one mobile address), tighter per person.
    if (!(await deps.allow(`tz:${ip}`, 120, 3600))) return { ok: false, status: 429 };
    const account = await deps.account();
    const memberIds = Object.values(await deps.memberships());
    const who = account?.id ?? memberIds[0];
    if (who && !(await deps.allow(`tz-who:${who}`, 20, 3600))) return { ok: false, status: 429 };
    return (await deps.save(body?.tz, account?.id ?? null, memberIds)) ? { ok: true, status: 200 } : { ok: false, status: 400 };
  } catch {
    return { ok: false, status: 500 };
  }
}
