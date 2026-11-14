import Link from "@/components/Link";
import { BackIcon, HomeIcon, iconButtonClass } from "./icons";
import { Notice } from "@/components/Notice";
import { BellButton } from "@/components/BellButton";

// Small shared building blocks so every screen looks the same.

// Every inner screen: Back (to where you came from) on the left, the title,
// and a separate Home button on the right.
export function PageHeader({
  title,
  back,
  action,
  hideTitle = false,
  titleClass = "text-[22px] min-[360px]:text-[28px]",
  bell = false,
}: {
  title: string;
  back?: string;
  bell?: boolean; // the Updates bell at the right (Your groups, You)
  hideTitle?: boolean; // the screen shows its own big title: keep this one for screen readers only
  action?: { href: string; label: string; icon: React.ReactNode };
  titleClass?: string; // a smaller size for a long title on a small phone
}) {
  return (
    <header className="mb-7 flex items-center gap-3">
      {back && (
        <Link href={back} aria-label="Back" className={iconButtonClass}>
          <BackIcon size={20} />
        </Link>
      )}
      {hideTitle && <span aria-hidden className="flex-1" />}
      <h1 className={`${hideTitle ? "sr-only" : "min-w-0 flex-1"} line-clamp-2 text-balance break-words font-display ${titleClass} font-semibold leading-tight tracking-[-0.02em]`}>{title}</h1>
      {action && (
        <Link href={action.href} aria-label={action.label} className={iconButtonClass}>
          {action.icon}
        </Link>
      )}
      {bell && <BellButton />}
      {back !== "/" && (
        <Link href="/" aria-label="Home" className={iconButtonClass}>
          <HomeIcon size={20} />
        </Link>
      )}
    </header>
  );
}

export const inputClass =
  "w-full rounded-2xl border border-line bg-mist px-4 py-3.5 text-base text-fg outline-none placeholder:text-gray-400 focus:border-fg/40 focus:ring-2 focus:ring-fg/10";

// The main button: an off-white pill that sinks a little when pressed.
export const primaryButtonClass =
  "pop block w-full bg-fg px-5 py-3.5 text-center text-base font-semibold text-canvas disabled:opacity-50";

// The second choice: an outline pill (see-through, 1px off-white edge).
export const secondaryButtonClass =
  "block w-full rounded-full border border-fg/25 bg-transparent px-5 py-3.5 text-center text-base font-semibold text-fg transition-transform active:scale-[0.97] active:bg-fg/10";

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <Notice key={typeof children === "string" ? children : undefined} tone="error" params={["error"]} className="mb-4">
      {children}
    </Notice>
  );
}

export function Avatar({ name }: { name: string }) {
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${avatarTone(name)}`}>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

// People are told apart by their initial, not by colour (colour is for money).
const TONES = ["bg-mist text-fg/75"];
export function avatarTone(name: string): string {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}
