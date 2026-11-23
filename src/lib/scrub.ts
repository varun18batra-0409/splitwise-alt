// Personal details never kept in logs: email addresses, phone-like numbers, long ids and tokens.
export function scrubPersonal(t: string): string {
  return t
    .replace(/[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/gi, "[email]")
    // Dates (2026-11-23) are not phone numbers: kept.
    .replace(/\+?\d[\d\s-]{8,}\d/g, (m) => (/^\d{4}-\d{2}-\d{2}$/.test(m) ? m : "[number]"))
    // ALL-CAPS codes (SQLITE_CONSTRAINT_UNIQUE) say what went wrong and hold nothing personal: kept. Other long runs are ids or tokens.
    .replace(/[A-Za-z0-9_-]{24,}/g, (m) => (/^[A-Z][A-Z0-9_]*$/.test(m) ? m : "[id]"));
}

// What is safe to log about a failed email: only the error's code and message, with personal details removed
// (the full error from the mail library can carry the address and the server's reply).
export function safeErrorNote(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  const code = typeof e?.code === "string" || typeof e?.code === "number" ? String(e.code) : "";
  const message = typeof e?.message === "string" ? e.message : "";
  return scrubPersonal([code, message].filter(Boolean).join(": ")).slice(0, 300) || "unknown error";
}
