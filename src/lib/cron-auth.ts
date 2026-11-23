// The daily and evening jobs run only for the caller that holds CRON_SECRET (Vercel sends it).
// With no secret set, a live (production) server refuses everything: a missing setting must never leave the jobs open.
// Development and tests (no secret) stay open but rate-limited, as before.
export function cronRefusedWithoutSecret(secret: string | undefined, nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return !secret && nodeEnv === "production";
}
