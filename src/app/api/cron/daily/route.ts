import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { allow, clientIp } from "@/lib/rate-limit";
import { eraseExpiredGroups } from "@/lib/purge";
import { makeStop, runClaimedParts } from "@/lib/daily-job";

// The daily job (Vercel Cron, 06:00 India time): adds the bills that are due.
// Safe to run more than once — every bill month is added at most once, and every
// group's nudge is claimed before it is sent. It stops starting new work after 50
// seconds and says what it left ("deferred"); the evening job picks up any
// unfinished sending and bills (it is the second run of the day).
// When CRON_SECRET is set (Vercel sends it), only that caller may run it.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sameSecret(given: string | null, secret: string) {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Each part runs on its own: one failing doesn't stop the rest (failures go in the admin's daily check).
// (Kept inside the request, so one run can never add to another's list.)
function makePart(failed: string[], deferred: string[], stop: () => boolean) {
  return async function part<T>(name: string, fn: () => Promise<T>): Promise<T | { error: string } | { deferred: true }> {
    if (stop()) {
      deferred.push(name);
      return { deferred: true };
    }
    try {
      return await fn();
    } catch (err) {
      console.error(`daily job: ${name} failed`, String(err).slice(0, 300));
      failed.push(name);
      return { error: "failed" };
    }
  };
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && !sameSecret(req.headers.get("authorization"), secret)) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  // No secret set: anyone may run it (it only adds what's due anyway), but not often.
  if (!secret && !(await allow(`cron:${clientIp(await headers())}`, 12, 3600))) {
    return Response.json({ error: "Too many runs" }, { status: 429 });
  }
  const now = new Date();
  const stop = makeStop();
  const failed: string[] = [];
  const deferred: string[] = [];
  const part = makePart(failed, deferred, stop);
  // Bills, reminders, countdowns, budgets, summaries, memories, postcards, photo-file clean-up.
  const main = await runClaimedParts(now, stop, failed);
  deferred.push(...main.deferred);
  // Speed numbers are kept two weeks.
  const speedLogsRemoved = await part("cleanup", async () => (await db.speedLog.deleteMany({ where: { at: { lt: new Date(now.getTime() - 14 * 86_400_000) } } })).count);
  // Error records are kept 30 days, as the privacy page says.
  await part("cleanup-errors", async () => (await db.errorLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } })).count);
  await part("cleanup-move", async () => (await db.requestKey.deleteMany({ where: { key: { startsWith: "move:" }, createdAt: { lt: new Date(now.getTime() - 86_400_000) } } })).count);
  // Housekeeping, so these small tables never grow without end: used-up sign-in
  // codes, finished rate-limit windows, unused passkey challenges, and the
  // one-time keys that make saves retry-safe (a retry comes within minutes).
  await part("cleanup-codes", async () => (await db.loginCode.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } } })).count);
  await part("cleanup-limits", async () => (await db.rateLimit.deleteMany({ where: { resetAt: { lt: new Date(now.getTime() - 86_400_000) } } })).count);
  await part("cleanup-passkey", async () => (await db.requestKey.deleteMany({ where: { key: { startsWith: "pk:" }, createdAt: { lt: new Date(now.getTime() - 86_400_000) } } })).count);
  await part("cleanup-keys", async () => (await db.requestKey.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } })).count);
  // Deleted collections: gone for good after 30 days.
  await part("cleanup-collections", async () => (await db.collection.deleteMany({ where: { deletedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } })).count);
  await part("cleanup-notes", async () => (await db.accountNote.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * 86_400_000) } } })).count);
  await part("cleanup-mail", async () => (await db.notifyLog.deleteMany({ where: { key: { startsWith: "mail-failed:" }, createdAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } })).count);
  // Bill photos taken while adding an expense that was never saved: gone after a day.
  await part("cleanup-receipts", async () => {
    const where = { expenseId: "", createdAt: { lt: new Date(now.getTime() - 86_400_000) } };
    // Exactly the rows whose files are removed, in batches: never a row deleted
    // without its file (that would leave the photo behind with nothing pointing at it).
    const { queuePhotoDeletes } = await import("@/lib/photo-store");
    let n = 0;
    for (let round = 0; round < 10; round++) {
      const batch = await db.receipt.findMany({ where, select: { id: true, blobKey: true }, take: 500 });
      if (!batch.length) break;
      // The rows go and their files' keys go on the to-delete list in the same step
      // (still unattached at this moment: one attached meanwhile is kept, and its key is not queued).
      n += await db.$transaction(async (tx) => {
        const mine = await tx.receipt.findMany({ where: { id: { in: batch.map((o) => o.id) }, expenseId: "" }, select: { id: true, blobKey: true } });
        await queuePhotoDeletes(tx, mine.map((o) => o.blobKey));
        return (await tx.receipt.deleteMany({ where: { id: { in: mine.map((o) => o.id) }, expenseId: "" } })).count;
      });
      if (batch.length < 500) break;
    }
    return n;
  });
  // Photos saved before file storage was connected move over, a few each day.
  await part("move-photos", async () => (await import("@/lib/photo-store")).movePhotosToBlob(60));
  // Groups deleted more than 30 days ago (past their restore window) are erased for good.
  const groupsErased = await part("erase-deleted-groups", () => eraseExpiredGroups(now));
  // The admin's email when something needs a look (failed parts, errors, emails not sent, orphan rows).
  const { sendOpsDigest } = await import("@/lib/ops-digest");
  const check = await sendOpsDigest(now, failed).catch(() => ({ sent: false, reason: "digest failed" }));
  return Response.json({ ok: true, ...main.results, speedLogsRemoved, groupsErased, deferred, check });
}
