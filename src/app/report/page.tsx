import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { safePath } from "@/lib/paths";
import { ErrorNote, PageHeader, inputClass, primaryButtonClass } from "@/components/ui";
import { SafetyLinks } from "@/components/SafetyLinks";
import { reportAction } from "@/app/safety-actions";
import { REASON_LABELS, REPORT_KINDS, REPORT_REASONS, resolveReportTarget } from "@/lib/reports";

export const metadata = { title: "Report", robots: { index: false } };

// A short form: what's wrong, and an optional note. After sending, a thank-you and the option to block.
export default async function ReportPage({ searchParams }: { searchParams: Promise<{ kind?: string; id?: string; back?: string; done?: string; error?: string }> }) {
  const sp = await searchParams;
  const kind = sp.kind ?? "";
  const id = sp.id ?? "";
  const back = safePath(sp.back || "/account");
  const me = await getAccount();
  if (!me) redirect(`/signin?back=${encodeURIComponent(`/report?${new URLSearchParams({ kind, id, back })}`)}`);
  if (!(REPORT_KINDS as readonly string[]).includes(kind)) redirect(back);
  const target = await resolveReportTarget(me.id, kind, id);
  if (!target) redirect(back);
  const who = await db.account.findUnique({ where: { id: target.accountId }, select: { name: true } });
  const first = (who?.name ?? "").trim().split(/\s+/)[0] || "this person";

  if (sp.done) {
    return (
      <>
        <PageHeader title="Report" back={back} />
        <div className="rounded-[20px] border border-line px-5 py-6" role="status" data-report-done>
          <p className="font-display text-xl font-semibold">Thanks. We’ll look at this within 24 hours.</p>
          <p className="mt-2 text-sm text-gray-500">You don’t have to do anything else. If you’d rather not hear from {first} meanwhile, you can block them.</p>
        </div>
        <SafetyLinks kind={kind as "postcard"} targetId={id} accountId={target.accountId} name={first} back={back} className="mt-4 [&_[data-report-link]]:hidden" />
        <Link href={back} className="mt-2 flex min-h-11 items-center justify-center text-sm font-semibold underline underline-offset-4">
          Back
        </Link>
      </>
    );
  }
  return (
    <>
      <PageHeader title={`Report ${first}`} back={back} />
      {sp.error && <ErrorNote>{sp.error.slice(0, 160)}</ErrorNote>}
      <p className="mb-5 text-sm text-gray-500">Tell us what’s wrong. Only Loopin sees this, not {first}.</p>
      <form action={reportAction} className="space-y-5">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="back" value={back} />
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-gray-600">What’s wrong?</legend>
          {REPORT_REASONS.map((r, i) => (
            <label key={r} className="flex min-h-12 items-center gap-3 rounded-2xl border border-line px-4 py-3">
              <input type="radio" name="reason" value={r} required defaultChecked={i === 0} className="h-5 w-5" />
              <span className="text-base">{REASON_LABELS[r]}</span>
            </label>
          ))}
        </fieldset>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-600">Anything we should know? (optional)</span>
          <textarea name="note" rows={3} maxLength={500} className={inputClass} />
        </label>
        <button type="submit" className={primaryButtonClass}>
          Send report
        </button>
      </form>
    </>
  );
}
