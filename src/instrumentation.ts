// Next.js calls this whenever a page or action crashes on the server. We keep
// a short note (personal details removed; kept 30 days) so problems show up
// on the private stats page, and could email an alert later.
export async function register() {}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { db } = await import("./lib/db");
    const e = err as { message?: string; digest?: string };
    // Personal details never kept: email addresses, phone-like numbers, long ids and tokens.
    const scrub = (t: string) =>
      t
        .replace(/[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/gi, "[email]")
        .replace(/\+?\d[\d\s-]{8,}\d/g, "[number]")
        .replace(/[A-Za-z0-9_-]{24,}/g, "[id]");
    await db.errorLog.create({
      data: {
        path: scrub(`${request.method} ${request.path.split("?")[0]}`).slice(0, 200),
        message: scrub(String(e?.message ?? err)).slice(0, 500),
        digest: String(e?.digest ?? "").slice(0, 100),
      },
    });
  } catch {
    // Never let error logging cause another error.
  }
}
