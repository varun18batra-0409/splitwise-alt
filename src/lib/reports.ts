import { db } from "./db";
import { sharesGroup } from "./blocks";
import { requireOwner } from "./owner";

export const REPORT_KINDS = ["postcard", "passport", "person"] as const;
export const REPORT_REASONS = ["spam", "abusive", "other"] as const;
export const REASON_LABELS: Record<string, string> = { spam: "Spam", abusive: "Abusive or unkind", other: "Something else", support: "Message for support" };

// Who a report is about, if the reporter really can see it: a postcard they were sent (its sender), or a person they share a group with.
export async function resolveReportTarget(reporterId: string, kind: string, id: string): Promise<{ accountId: string } | null> {
  if (kind === "postcard") {
    const card = await db.postcard.findFirst({ where: { id, toId: reporterId }, select: { fromId: true } });
    return card ? { accountId: card.fromId } : null;
  }
  if (kind === "passport" || kind === "person") {
    if (id === reporterId || !(await sharesGroup(reporterId, id))) return null;
    return { accountId: id };
  }
  return null;
}

// A message to support is saved here first, so it is never lost when the email can't be sent (or is capped).
// reporterId is "" for someone who isn't signed in.
export async function saveSupportMessage(o: { reporterId?: string; message: string; contact?: string }) {
  return db.report.create({ data: { reporterId: o.reporterId ?? "", kind: "support", targetId: "", targetAccountId: "", reason: "support", note: o.message.slice(0, 1500), contact: (o.contact ?? "").slice(0, 120) } });
}

// What /stats/reports shows. Owner only: anyone else gets "not found" before anything is read.
export async function loadReportsForOwner(account: { email: string } | null | undefined) {
  requireOwner(account);
  // Two lists, so a flood of one kind can never push the other off the page. Open ones first, then newest.
  const order = [{ status: "asc" as const }, { createdAt: "desc" as const }]; // "open" sorts before "resolved"
  const [reports, support] = await Promise.all([
    db.report.findMany({ where: { kind: { not: "support" } }, orderBy: order, take: 100 }),
    db.report.findMany({ where: { kind: "support" }, orderBy: order, take: 100 }),
  ]);
  return { reports, support };
}
