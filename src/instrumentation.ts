// Next.js calls this whenever a page or action crashes on the server. We keep
// a short note (no personal data beyond the page address) so problems show up
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
    await db.errorLog.create({
      data: {
        path: `${request.method} ${request.path.split("?")[0]}`.slice(0, 200),
        message: String(e?.message ?? err).slice(0, 500),
        digest: String(e?.digest ?? "").slice(0, 100),
      },
    });
  } catch {
    // Never let error logging cause another error.
  }
}
