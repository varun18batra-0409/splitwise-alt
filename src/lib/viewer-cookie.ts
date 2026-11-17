// The browser's own random value (lp_v), used to tie a signed message to the browser it was made for (see flash.ts).
// Pure and edge-safe (Web APIs only), so the middleware can use it too.
// On the live site the name carries the __Host- prefix: browsers then refuse the cookie unless it was set by this exact host over
// https with path=/ and no Domain, so a sibling subdomain or a plain-http hop can't plant a value of its choosing.
const SECURE = process.env.NODE_ENV === "production" && process.env.E2E_PLAIN_HTTP !== "1";
export const VIEWER_COOKIE = SECURE ? "__Host-lp_v" : "lp_v";

export function cleanViewer(v: unknown): string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{22,64}$/.test(v) ? v : "";
}

// 128 bits, URL-safe.
export function newViewerId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function viewerCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: SECURE, path: "/", maxAge: 60 * 60 * 24 * 730 };
}
