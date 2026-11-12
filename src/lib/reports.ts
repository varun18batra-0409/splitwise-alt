import { db } from "./db";
import { sharesGroup } from "./blocks";

export const REPORT_KINDS = ["postcard", "passport", "person"] as const;
export const REPORT_REASONS = ["spam", "abusive", "other"] as const;
export const REASON_LABELS: Record<string, string> = { spam: "Spam", abusive: "Abusive or unkind", other: "Something else" };

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
