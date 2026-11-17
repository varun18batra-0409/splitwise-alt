import Link from "@/components/Link";
import { BackIcon, iconButtonClass } from "@/components/icons";

// Bills, Shopping list and Charts open with their own plain title bar instead of the group's picture and tab bar:
// Back (to the group's Overview, where you came from), the page's title, and the group's name underneath.
// Long names wrap; nothing is cut off.
export function SubPageHeader({ title, groupId, groupName }: { title: string; groupId: string; groupName: string }) {
  return (
    <header className="mb-5 flex items-start gap-3" data-sub-header>
      <Link href={`/groups/${groupId}`} aria-label={`Back to ${groupName}`} className={`${iconButtonClass} mt-0.5`} data-sub-back>
        <BackIcon size={20} />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="break-words font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] min-[360px]:text-[30px]">{title}</h1>
        <p className="break-words text-sm text-fg/60">{groupName}</p>
      </div>
    </header>
  );
}
