import { db } from "./db";
import { sharesGroup } from "./blocks";
import { requireOwner } from "./owner";
import { canReportMoment, loadMomentViewer } from "./moments-access";
import { loadMomentRow } from "./moments-db";

export const REPORT_KINDS = ["postcard", "passport", "person", "moment"] as const;
export const REPORT_REASONS = ["spam", "abusive", "other"] as const;
export const REASON_LABELS: Record<string, string> = { spam: "Spam", abusive: "Abusive or unkind", other: "Something else", support: "Message for support" };

// Who a report is about, if the reporter really can see it: a postcard they were sent (its sender), a person they share a group with,
// or a moment in a group they can see (its author).
export async function resolveReportTarget(reporterId: string, kind: string, id: string): Promise<{ accountId: string } | null> {
  if (kind === "postcard") {
    const card = await db.postcard.findFirst({ where: { id, toId: reporterId }, select: { fromId: true } });
    return card ? { accountId: card.fromId } : null;
  }
  if (kind === "moment") {
    const m = await loadMomentRow(id);
    if (!m) return null;
    const me = await db.member.findFirst({ where: { accountId: reporterId, groupId: m.groupId }, orderBy: { createdAt: "desc" }, select: { id: true } });
    const viewer = me ? await loadMomentViewer(m.groupId, me.id) : null;
    return canReportMoment(viewer, m) ? { accountId: m.authorAccountId } : null;
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

export const REPORTS_PAGE_SIZE = 100;

// "7 to look at" / "100+ to look at": open ones come first and only a page of them is loaded, so a full page means "at least this many".
export const openLabel = (open: number): string => (open >= REPORTS_PAGE_SIZE ? `${REPORTS_PAGE_SIZE}+` : String(open));

// What /stats/reports shows. Owner only: anyone else gets "not found" before anything is read.
export async function loadReportsForOwner(account: { email: string } | null | undefined) {
  requireOwner(account);
  // Two lists, so a flood of one kind can never push the other off the page. Open ones first, then newest.
  const order = [{ status: "asc" as const }, { createdAt: "desc" as const }]; // "open" sorts before "resolved"
  const [reports, support] = await Promise.all([
    db.report.findMany({ where: { kind: { not: "support" } }, orderBy: order, take: REPORTS_PAGE_SIZE }),
    db.report.findMany({ where: { kind: "support" }, orderBy: order, take: REPORTS_PAGE_SIZE }),
  ]);
  return { reports, support };
}
