// When a sign-in or name-link takes this phone's notification rows away (so that OTHER phones holding the same guest
// name stop hearing about it), this phone has to put its own back. The server can't tell which address is this phone's,
// so it leaves a short-lived note in a cookie and the app (PushSync) re-registers this phone right away.
// Safe for the browser: no server imports.
export const PUSH_RESYNC_COOKIE = "loopin_push_resync";
export const PUSH_RESYNC_MAX_AGE = 60 * 60 * 24; // one day
const THROTTLE_MS = 6 * 3600_000;

export const hasResyncCookie = (cookieHeader: string): boolean => cookieHeader.split(";").some((p) => p.trim() === `${PUSH_RESYNC_COOKIE}=1`);

// What PushSync should do when it starts: nothing (still inside the 6-hour throttle), or register this phone's
// subscription for all its names. A resync note skips the throttle.
export function pushSyncPlan(o: { granted: boolean; cookieHeader: string; lastSyncMs: number; nowMs: number }): { run: boolean; resync: boolean } {
  if (!o.granted) return { run: false, resync: false };
  const resync = hasResyncCookie(o.cookieHeader);
  if (resync) return { run: true, resync: true };
  return { run: o.nowMs - o.lastSyncMs >= THROTTLE_MS, resync: false };
}

export const clearResyncCookieString = () => `${PUSH_RESYNC_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;
