// Next.js calls this whenever a page or action crashes on the server. We keep
// a short note (personal details removed; kept 30 days) so problems show up
// on the private stats page, and could email an alert later.
export async function register() {
  // Node only (the edge build must never see Node's perf_hooks): the speed log for the CI load test.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPerfLoop } = await import("./perf-loop");
    startPerfLoop();
  }
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { db } = await import("./lib/db");
    const e = err as { message?: string; digest?: string };
    const { scrubPersonal: scrub } = await import("./lib/scrub");
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
