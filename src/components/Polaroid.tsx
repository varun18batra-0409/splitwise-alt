import { GroupCover } from "./GroupCover";
import type { CoverChoice } from "@/lib/covers";

// A group's picture as an instant photo: an off-white frame with a deeper
// bottom edge, the name written underneath by hand, and a short note (your
// balance there). Loopin's version of "photos tossed on the table": the
// tilt and position come from where it's used.

export const INK = "#26231d"; // the pen
export const INK_OWED = "#137a4c"; // green ink: owed to you
export const INK_OWE = "#b4541a"; // orange ink: you owe

export function Polaroid({
  cover,
  uid,
  letter,
  caption,
  note,
  noteTone,
  photoClass = "h-[76px]",
  className = "",
  style,
  sizes = "120px",
  children,
  captionClass = "text-[17px]",
}: {
  cover: { kind: CoverChoice; src?: string };
  uid: string;
  letter: string;
  caption: string;
  note?: string;
  noteTone?: "owed" | "owe";
  photoClass?: string;
  className?: string;
  style?: React.CSSProperties;
  sizes?: string;
  children?: React.ReactNode; // laid over the photo (labels, faces)
  captionClass?: string;
}) {
  return (
    <span
      className={`block bg-[#f4f1e8] p-[5px] pb-0 shadow-[0_16px_30px_-12px_rgba(0,0,0,0.95),0_2px_6px_rgba(0,0,0,0.35)] ${className}`}
      style={style}
    >
      <span className={`relative block overflow-hidden bg-[#1c1b20] ${photoClass}`}>
        <GroupCover {...cover} uid={uid} letter={letter} small sizes={sizes} />
        {/* a little film sheen */}
        <span aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,rgba(255,255,255,0.10),transparent_40%,rgba(0,0,0,0.12))]" />
        {children}
      </span>
      <span className="block px-1 pb-1.5 pt-0.5 leading-none" style={{ color: INK }}>
        <span className={`block truncate font-hand font-bold leading-[1.1] ${captionClass}`}>{caption}</span>
        {note && (
          <span className="mt-0.5 block truncate text-[11px] font-semibold tabular-nums" style={{ color: noteTone === "owed" ? INK_OWED : noteTone === "owe" ? INK_OWE : "#6d685e" }}>
            {note}
          </span>
        )}
      </span>
    </span>
  );
}
