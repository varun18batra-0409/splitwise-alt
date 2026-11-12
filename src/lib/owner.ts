import { notFound } from "next/navigation";

// The owner: whoever signs in with an email listed in the ADMIN_EMAIL setting (comma-separated for more than one).
// Same rule as /stats.
export function ownerEmails(): string[] {
  return (process.env.ADMIN_EMAIL ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function isOwner(account: { email: string } | null | undefined): boolean {
  return Boolean(account && ownerEmails().includes(account.email.trim().toLowerCase()));
}

// For owner-only pages (/stats/reports): anyone else gets the same "not found" as /stats.
export function requireOwner(account: { email: string } | null | undefined): void {
  if (!isOwner(account)) notFound();
}
