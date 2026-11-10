import { signText } from "./session";

// "Don't want these emails?" links for invite and "you were added" emails.
// The link carries the address and a signature, so nobody can unsubscribe someone else.
const base = () => (process.env.APP_URL || "https://www.loopinapps.com").replace(/\/$/, "");

export async function unsubscribeUrl(email: string): Promise<string> {
  const e = email.trim().toLowerCase();
  return `${base()}/api/unsubscribe?${new URLSearchParams({ e, s: await signText(`unsub:${e}`) })}`;
}
