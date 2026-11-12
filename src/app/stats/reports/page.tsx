import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { PageHeader } from "@/components/ui";
import { resolveReportAction } from "@/app/safety-actions";
import { REASON_LABELS, REPORTS_PAGE_SIZE, loadReportsForOwner } from "@/lib/reports";

export const metadata = { title: "Reports", robots: { index: false } };
export const dynamic = "force-dynamic";

// Owner only (the same rule as /stats): what people reported, newest first, with a Resolved button.
// Shows who and what, never the private photo itself.
export default async function Reports() {
  const account = await getAccount();
  const { reports, support } = await loadReportsForOwner(account);
  const rows = [...reports, ...support];
  const ids = [...new Set(rows.flatMap((r) => [r.reporterId, r.targetAccountId]).filter(Boolean))];
  const people = ids.length ? await db.account.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const who = new Map(people.map((p) => [p.id, `${p.name || "No name"} (${p.email})`]));
  const tz = await getTimeZone();
  const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz });
  const list = (items: typeof rows) => (
    <ul className="divide-y divide-line border-y border-line">
      {items.map((r) => (
        <li key={r.id} className="py-4" data-report={r.id} data-status={r.status}>
          <p className="text-sm font-semibold">
            {r.kind === "support" ? "Message for support" : `${REASON_LABELS[r.reason] ?? r.reason} · ${r.kind}`} · {when(r.createdAt)}
          </p>
          {r.kind !== "support" && <p className="mt-1 text-sm text-gray-500">About: {who.get(r.targetAccountId) ?? "an account that no longer exists"}</p>}
          <p className="text-sm text-gray-500">From: {r.reporterId ? (who.get(r.reporterId) ?? "an account that no longer exists") : "someone not signed in"}</p>
          {r.contact && <p className="text-sm text-gray-500">Reply to: {r.contact}</p>}
          {r.note && <p className="mt-1 break-words text-sm">“{r.note}”</p>}
          {r.status === "open" ? (
            <form action={resolveReportAction} className="mt-2">
              <input type="hidden" name="id" value={r.id} />
              <button type="submit" className="min-h-11 rounded-full border border-line px-4 text-sm font-medium active:bg-mist">
                Resolved
              </button>
            </form>
          ) : (
            <p className="mt-1 text-xs text-gray-400">Resolved{r.resolvedAt ? ` ${when(r.resolvedAt)}` : ""}</p>
          )}
        </li>
      ))}
    </ul>
  );
  // Open ones come first and only a page of them is loaded, so a full page of open ones means "at least this many".
  const openCount = (items: typeof rows) => items.filter((r) => r.status === "open").length;
  const openLabel = (items: typeof rows) => (openCount(items) >= REPORTS_PAGE_SIZE ? `${REPORTS_PAGE_SIZE}+` : String(openCount(items)));
  return (
    <>
      <PageHeader title="Reports" back="/stats" />
      <h2 className="mb-1 font-display text-xl font-semibold">Reports</h2>
      <p className="mb-4 text-sm text-gray-500" data-open-reports={openCount(reports)}>
        {openCount(reports) ? `${openLabel(reports)} to look at` : "Nothing waiting."}
      </p>
      {reports.length > 0 && list(reports)}
      <h2 className="mb-1 mt-10 font-display text-xl font-semibold">Support messages</h2>
      <p className="mb-4 text-sm text-gray-500" data-open-support={openCount(support)}>
        {openCount(support) ? `${openLabel(support)} to look at` : "Nothing waiting."}
      </p>
      {support.length > 0 && list(support)}
    </>
  );
}
