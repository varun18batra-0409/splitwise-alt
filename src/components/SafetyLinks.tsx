import Link from "@/components/Link";
import { ConfirmButton } from "@/components/ConfirmButton";
import { blockAction } from "@/app/safety-actions";

export const blockText = (name: string) =>
  `Block ${name}? They won’t be able to send you postcards, passports or nudges, and you won’t see their cards or passport. You’ll still see shared group expenses and balances.`;

// "Report" and "Block {name}", side by side and quiet. `kind`/`targetId` say what is being reported
// (a postcard id, or the person's account id); `accountId` is the person to block; `back` is where Report returns to.
export function SafetyLinks({ kind, targetId, accountId, name, back, className = "", rows = false }: { kind: "postcard" | "passport" | "person" | "moment"; targetId: string; accountId: string; name: string; back: string; className?: string; rows?: boolean }) {
  const first = name.trim().split(/\s+/)[0] || "them";
  const quiet = "inline-flex min-h-11 items-center px-2 text-sm font-medium text-fg/60 underline underline-offset-4 active:text-fg";
  if (rows) {
    // Stacked rows inside a menu (a moment's "⋯"): one thing per row, each at least 44 px high. Block asks first.
    const row = "flex min-h-11 w-full items-center px-3 text-left text-[15px] font-medium text-fg/75 active:text-fg";
    return (
      <div className={`flex flex-col ${className}`} data-safety-links>
        <Link href={`/report?${new URLSearchParams({ kind, id: targetId, back })}`} className={row} data-report-link>
          {kind === "moment" ? "Report this moment" : "Report"}
        </Link>
        <form action={blockAction}>
          <input type="hidden" name="accountId" value={accountId} />
          <input type="hidden" name="back" value={back} />
          <ConfirmButton message={blockText(first)} className={row}>
            Block {first}
          </ConfirmButton>
        </form>
      </div>
    );
  }
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-3 ${className}`} data-safety-links>
      <Link href={`/report?${new URLSearchParams({ kind, id: targetId, back })}`} className={quiet} data-report-link>
        Report
      </Link>
      <form action={blockAction}>
        <input type="hidden" name="accountId" value={accountId} />
        <input type="hidden" name="back" value={back} />
        <ConfirmButton message={blockText(first)} className={quiet}>
          Block {first}
        </ConfirmButton>
      </form>
    </div>
  );
}
