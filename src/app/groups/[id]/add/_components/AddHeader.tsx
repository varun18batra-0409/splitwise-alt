import Link from "@/components/Link";
import { GroupCover } from "@/components/GroupCover";
import { BackIcon } from "@/components/icons";
import type { CoverChoice } from "@/lib/covers";

// Add expense's top: Back, the group's small picture (40px, rounded 12) and "Add to <group>" in Fraunces.
// The picture is the same one the group's polaroid shows (its own photo, the place photo, or the drawn cover).
export function AddHeader({
  title,
  back,
  cover,
  photo,
  uid,
  letter,
}: {
  title: string;
  back: string;
  cover: { kind: CoverChoice; src?: string };
  photo?: string;
  uid: string;
  letter?: string;
}) {
  return (
    <header className="mb-6 flex items-center gap-3">
      <Link href={back} aria-label="Back" className="glass flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-fg active:scale-95">
        <BackIcon size={20} />
      </Link>
      <span aria-hidden className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[12px] bg-mist">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <GroupCover {...cover} uid={`add-${uid}`} letter={letter} small sizes="40px" />
        )}
      </span>
      <h1 className="min-w-0 flex-1 truncate font-display text-[21px] font-semibold tracking-[-0.01em]">{title}</h1>
    </header>
  );
}
