import Link from "@/components/Link";
import { GroupCover } from "@/components/GroupCover";
import { BackIcon } from "@/components/icons";
import type { CoverChoice } from "@/lib/covers";

// A form that slides up over its group: the group's picture, dimmed, along the top, and the
// form on a sheet with rounded corners above it (Add expense, Edit expense, Record a payment).
export function SheetPage({
  title,
  back,
  cover,
  photo,
  uid,
  letter,
  children,
}: {
  title: string;
  back: string;
  cover: { kind: CoverChoice; src?: string };
  photo?: string;
  uid: string;
  letter?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="relative -mx-5 -mt-[max(1.5rem,env(safe-area-inset-top))] h-[150px] overflow-hidden" aria-hidden>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <GroupCover {...cover} uid={`sheet-${uid}`} letter={letter} sizes="(max-width: 448px) 100vw, 448px" />
        )}
        <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.35),rgba(0,0,0,0.65))]" />
      </div>
      <div className="absolute inset-x-0 top-0 mx-auto flex max-w-md items-center gap-3 px-5 pt-[max(1.1rem,env(safe-area-inset-top))]">
        <Link href={back} aria-label="Back" className="glass flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-fg active:scale-95">
          <BackIcon size={20} />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-display text-[22px] font-semibold tracking-[-0.01em] [text-shadow:0_2px_12px_rgba(0,0,0,0.5)]">{title}</h1>
      </div>
      <div className="relative -mx-5 -mt-12 min-h-[calc(100dvh-110px)] -mb-32 rounded-t-[30px] border-t border-fg/[0.08] bg-white px-5 pb-40 pt-6 shadow-[0_-24px_60px_rgba(0,0,0,0.55)]">
        {children}
      </div>
    </>
  );
}
