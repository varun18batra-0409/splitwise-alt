import Link from "@/components/Link";
import { ChartsTab } from "./ChartsTab";
import type { GroupView } from "./view";

// Trip recap: the charts (which already carry the Trip report and Wrapped links once the trip has something to show), then search.
// It is not in the tab bar: the Overview's footer opens it, and "‹ Overview" goes back.
export function RecapTab({ v }: { v: GroupView }) {
  const { group, expenses } = v;
  return (
    <div className="space-y-8">
      <Link href={`/groups/${group.id}`} className="-mt-2 inline-flex min-h-11 items-center text-sm text-gray-500" data-recap-back>
        ‹ Overview
      </Link>
      <ChartsTab v={v} />
      {expenses.length > 0 && (
        <Link href={`/search?g=${group.id}`} className="flex min-h-11 items-center justify-between gap-3 border-y border-line py-2 text-[15px] font-medium text-fg/85 active:opacity-70" data-recap-search>
          Search all expenses
          <span aria-hidden className="text-fg/40">›</span>
        </Link>
      )}
    </div>
  );
}
