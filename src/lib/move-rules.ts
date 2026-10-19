// Loopin's address moved to loopinapps.com. Pure rules (no database), so the
// middleware can use them.

export const PRIMARY_HOST = process.env.PRIMARY_HOST || "loopinapps.com";
// The old addresses people may still have on their home screen or in old links.
export const OLD_HOSTS = ["getloopin.vercel.app", "splitwise-alt-bovz.vercel.app"];

export function isOldHost(host: string | null | undefined): boolean {
  return OLD_HOSTS.includes(String(host ?? "").toLowerCase().split(":")[0]);
}

// Only screens move. The daily job, notifications, the app's background
// worker and files keep working on the old address while people move over.
export function shouldMove(host: string | null | undefined, method: string, pathname: string): boolean {
  if (!isOldHost(host)) return false;
  if (method !== "GET" && method !== "HEAD") return false;
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/")) return false;
  if (/\.[a-z0-9]+$/i.test(pathname)) return false; // sw.js, icons, manifest, photos
  return true;
}
