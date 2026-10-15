import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { allow } from "./rate-limit";
import { sendMail, mailConfigured } from "./mail";

// Optional email sign-in with a 6-digit code (also sent as a one-tap link).
// A code works once, for 15 minutes, with at most 5 tries.

const CODE_MINUTES = 15;
const MAX_TRIES = 5;

export function cleanEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/.test(e) ? e : null;
}

export function hashLoginCode(email: string, code: string): string {
  const pepper = process.env.AUTH_SECRET ?? process.env.TURSO_AUTH_TOKEN ?? "loopin-dev";
  return createHash("sha256").update(`${pepper}:${email}:${code}`).digest("hex");
}

export type CodeResult = { ok: true } | { ok: false; error: string };

export async function requestLoginCode(rawEmail: string, ip: string, origin: string, now = new Date()): Promise<CodeResult> {
  const email = cleanEmail(rawEmail);
  if (!email) return { ok: false, error: "Enter a valid email address." };
  if (!mailConfigured()) return { ok: false, error: "Email sign-in isn't switched on yet. Try again later." };
  const testing = process.env.MAIL_OUTBOX === "1" && !process.env.VERCEL; // automated tests only
  if (!testing && (!(await allow(`code-ip:${ip}`, 8, 15 * 60, now)) || !(await allow(`code-email:${email}`, 4, 15 * 60, now)))) {
    return { ok: false, error: "Too many codes asked for. Wait 15 minutes and try again." };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.loginCode.create({
    data: { email, codeHash: hashLoginCode(email, code), expiresAt: new Date(now.getTime() + CODE_MINUTES * 60_000) },
  });
  const link = `${origin}/signin/verify?e=${encodeURIComponent(email)}&c=${code}`;
  const sent = await sendMail(
    email,
    `${code} is your Loopin code`,
    `Your Loopin sign-in code is ${code}\n\nOr tap: ${link}\n\nIt works for ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email.`,
    `<div style="font-family:system-ui,sans-serif;max-width:420px">
      <p style="font-size:15px;color:#333">Your Loopin sign-in code:</p>
      <p style="font-size:34px;letter-spacing:6px;font-weight:700;margin:8px 0">${code}</p>
      <p><a href="${link}" style="display:inline-block;background:#0d0d0f;color:#f4f2ec;padding:12px 18px;text-decoration:none;font-weight:600">Sign in to Loopin</a></p>
      <p style="font-size:13px;color:#777">It works for ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email.</p>
    </div>`,
  );
  return sent ? { ok: true } : { ok: false, error: "Couldn't send the email. Check the address and try again." };
}

// Returns the account id on success.
export async function verifyLoginCode(rawEmail: string, rawCode: string, now = new Date()): Promise<{ ok: true; accountId: string } | { ok: false; error: string }> {
  const email = cleanEmail(rawEmail);
  const code = rawCode.replace(/\D/g, "");
  if (!email || code.length !== 6) return { ok: false, error: "Enter the 6-digit code from the email." };
  const row = await db.loginCode.findFirst({
    where: { email, usedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return { ok: false, error: "That code has expired. Ask for a new one." };
  if (row.attempts >= MAX_TRIES) return { ok: false, error: "Too many wrong tries. Ask for a new code." };
  const a = Buffer.from(row.codeHash, "hex");
  const b = Buffer.from(hashLoginCode(email, code), "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await db.loginCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, error: "That code isn't right. Check the email and try again." };
  }
  await db.loginCode.update({ where: { id: row.id }, data: { usedAt: now } });
  const account = await db.account.upsert({ where: { email }, create: { email }, update: {} });
  return { ok: true, accountId: account.id };
}

// "Delete my account": the email and sign-in codes are removed; group
// histories keep the names people used in them.
export async function deleteAccount(accountId: string) {
  const acc = await db.account.findUnique({ where: { id: accountId } });
  if (!acc) return;
  await db.$transaction([
    db.member.updateMany({ where: { accountId }, data: { accountId: null } }),
    db.loginCode.deleteMany({ where: { email: acc.email } }),
    db.account.delete({ where: { id: accountId } }),
  ]);
}
