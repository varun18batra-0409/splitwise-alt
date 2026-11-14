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

function devPepper(): string {
  if (process.env.VERCEL_ENV === "production") throw new Error("Sign-in is not set up: AUTH_SECRET is missing on the live app.");
  return "loopin-dev";
}

export function hashLoginCode(email: string, code: string): string {
  const pepper = process.env.AUTH_SECRET ?? process.env.TURSO_AUTH_TOKEN ?? devPepper();
  return createHash("sha256").update(`${pepper}:${email}:${code}`).digest("hex");
}

export type CodeResult = { ok: true } | { ok: false; error: string };

export async function requestLoginCode(rawEmail: string, ip: string, origin: string, now = new Date(), back = "/"): Promise<CodeResult> {
  const email = cleanEmail(rawEmail);
  if (!email) return { ok: false, error: "Enter a valid email address." };
  if (!mailConfigured()) return { ok: false, error: "Email sign-in isn't switched on yet. Try again later." };
  // Automated tests only: the outbox mode, or ".test" addresses on the private test copy (they never reach a real inbox).
  const testing = (process.env.MAIL_OUTBOX === "1" && !process.env.VERCEL) || (process.env.VERCEL_ENV === "preview" && /\.test$/i.test(email));
  if (!testing && (!(await allow(`code-ip:${ip}`, 8, 15 * 60, now)) || !(await allow(`code-email:${email}`, 4, 15 * 60, now)))) {
    return { ok: false, error: "Too many codes asked for. Wait 15 minutes and try again." };
  }
  // At most 12 codes a day for one address (5 tries each): guessing a code stays hopeless.
  if (!testing && !(await allow(`code-email-day:${email}`, 12, 86_400, now))) {
    return { ok: false, error: "Too many codes asked for today. Try again tomorrow, or sign in with Google or your fingerprint or face above." };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.loginCode.create({
    data: { email, codeHash: hashLoginCode(email, code), expiresAt: new Date(now.getTime() + CODE_MINUTES * 60_000) },
  });
  // Where they were going (an invite, a group) comes along, so opening the email elsewhere still lands there.
  const link = `${origin}/signin/verify?e=${encodeURIComponent(email)}&c=${code}${back && back !== "/" && back.startsWith("/") && !back.startsWith("//") ? `&b=${encodeURIComponent(back.slice(0, 200))}` : ""}`;
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
    { signInCode: true },
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
  // Use up one try BEFORE comparing, in one step, so many guesses sent at the
  // same moment can't get more than 5 tries between them.
  const tried = await db.loginCode.updateMany({
    where: { id: row.id, usedAt: null, attempts: { lt: MAX_TRIES } },
    data: { attempts: { increment: 1 } },
  });
  if (tried.count !== 1) return { ok: false, error: "Too many wrong tries. Ask for a new code." };
  const a = Buffer.from(row.codeHash, "hex");
  const b = Buffer.from(hashLoginCode(email, code), "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: "That code isn't right. Check the email and try again." };
  }
  const used = await db.loginCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
  if (used.count !== 1) return { ok: false, error: "That code was already used. Ask for a new one." };
  const account = await db.account.upsert({ where: { email }, create: { email }, update: {} });
  return { ok: true, accountId: account.id };
}

// "Delete my account": the email and sign-in codes are removed; group
// histories keep the names people used in them.
// keepEndpoint: this phone's notification address. The account's people stop getting notifications on every OTHER
// phone (those rows are deleted); this phone's stays, so it keeps working for the groups it still has. Without it,
// all of them go (this phone's comes back by itself the next time the app is opened).
// `afterRead` is for tests only: it runs before the transaction begins.
export async function deleteAccount(accountId: string, opts: { keepEndpoint?: string; afterRead?: () => Promise<void> } = {}) {
  const acc = await db.account.findUnique({ where: { id: accountId } });
  if (!acc) return;
  const keep = opts.keepEndpoint ?? "";
  const { queuePhotoDeletes, flushPhotoDeletes } = await import("./photo-store");
  await opts.afterRead?.();
  // One transaction that starts with a write (so it holds the write lock): a postcard sent, or a photo copied to file
  // storage, a moment ago is seen and handled, not missed.
  await db.$transaction(
    async (tx) => {
      // Notifications on the account's other phones stop (before the people are unlinked from the account).
      await tx.pushSubscription.deleteMany({ where: { member: { accountId }, ...(keep ? { endpoint: { not: keep } } : {}) } });
      // Postcards they sent or received go with them, and so do their photos
      // (unless another remaining card still uses the same photo).
      const cards = await tx.postcard.findMany({ where: { OR: [{ fromId: accountId }, { toId: accountId }] }, select: { id: true, photoId: true } });
      // Photos they uploaded (their own uploads and copies of their moments), even ones no card uses any more, go with them.
      const uploaded = (await tx.postcardPhoto.findMany({ where: { accountId }, select: { id: true } })).map((p) => p.id);
      const photoIds = [...new Set([...cards.map((c) => c.photoId).filter(Boolean), ...uploaded])];
      const stillUsed = photoIds.length
        ? new Set((await tx.postcard.findMany({ where: { photoId: { in: photoIds }, id: { notIn: cards.map((c) => c.id) } }, select: { photoId: true } })).map((c) => c.photoId))
        : new Set<string>();
      const goneIds = photoIds.filter((p) => !stillUsed.has(p));
      const goneFiles = (await tx.postcardPhoto.findMany({ where: { id: { in: goneIds } }, select: { blobKey: true } })).map((p) => p.blobKey);
      await queuePhotoDeletes(tx, goneFiles);
      // Each name gets a new grant epoch, so old copies of this phone-only access elsewhere stop working (SEC-01).
      await tx.member.updateMany({ where: { accountId }, data: { accountId: null, grantEpoch: { increment: 1 } } });
      await tx.loginCode.deleteMany({ where: { email: acc.email } });
      await tx.postcard.deleteMany({ where: { id: { in: cards.map((c) => c.id) } } });
      await tx.postcardPhoto.deleteMany({ where: { id: { in: goneIds } } });
      // Moments they added go too, photos and all (reactions on them with them). Reactions they made elsewhere stay, like
      // reactions on expenses, under the group's own name.
      const mine = await tx.moment.findMany({ where: { authorAccountId: accountId }, select: { id: true, blobKey: true, thumbKey: true } });
      await queuePhotoDeletes(tx, mine.flatMap((m) => [m.blobKey, m.thumbKey]));
      await tx.momentReaction.deleteMany({ where: { momentId: { in: mine.map((m) => m.id) } } });
      await tx.moment.deleteMany({ where: { authorAccountId: accountId } });
      // Open reports about those moments are left open on purpose: the operator still sees them (repeat offenders stay visible).
      await tx.passkey.deleteMany({ where: { accountId } });
      // Collections they organised hold other people's names under their account: they go too.
      await tx.collection.deleteMany({ where: { accountId } });
      await tx.accountNote.deleteMany({ where: { accountId } });
      // Blocks you made or that were made against you go with the account (reports stay: they are the record of what was reported).
      // Messages this account sent to support go with it (reports stay, as they are the record of what was reported).
      await tx.report.deleteMany({ where: { kind: "support", reporterId: accountId } });
      await tx.block.deleteMany({ where: { OR: [{ blockerId: accountId }, { blockedId: accountId }] } });
      await tx.collectionEntry.updateMany({ where: { accountId }, data: { accountId: "" } });
      await tx.account.delete({ where: { id: accountId } });
    },
    { timeout: 30000 },
  );
  await flushPhotoDeletes();
}
