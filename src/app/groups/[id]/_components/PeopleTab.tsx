import Link from "@/components/Link";
import { BalancesTab } from "./BalancesTab";
import type { GroupView } from "./view";

// People = today's Balances (who owes what, and why), with the way to add or remove people at the end.
export function PeopleTab({ v, paid, why }: { v: GroupView; paid?: boolean; why?: string }) {
  return (
    <div>
      <BalancesTab v={v} paid={paid} why={why} />
      {!v.leaver && !v.group.closed && (
        <Link href={`/groups/${v.group.id}/people`} className="mt-6 flex min-h-11 items-center justify-center text-[15px] font-medium text-fg/85 underline underline-offset-4 active:opacity-70" data-manage-people>
          Manage people
        </Link>
      )}
    </div>
  );
}
