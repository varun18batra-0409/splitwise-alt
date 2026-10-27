import Link from "@/components/Link";
import { BackIcon, HomeIcon, iconButtonClass } from "./icons";
import { Notice } from "@/components/Notice";

// Small shared building blocks so every screen looks the same.

// Every inner screen: Back (to where you came from) on the left, the title,
// and a separate Home button on the right.
export function PageHeader({
  title,
  back,
  action,
}: {
  title: string;
  back?: string;
  action?: { href: string; label: string; icon: React.ReactNode };
}) {
  return (
    <header className="mb-7 flex items-center gap-3">
      {back && (
        <Link href={back} aria-label="Back" className={iconButtonClass}>
          <BackIcon size={20} />
        </Link>
      )}
      <h1 className="min-w-0 flex-1 truncate font-display text-[28px] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
      {action && (
        <Link href={action.href} aria-label={action.label} className={iconButtonClass}>
          {action.icon}
        </Link>
      )}
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

// The second choice: a quiet see-through pill.
export const secondaryButtonClass =
  "block w-full rounded-full border border-fg/15 bg-fg/[0.06] px-5 py-3.5 text-center text-base font-semibold text-fg transition-transform active:scale-[0.97] active:bg-fg/10";

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <Notice tone="error" params={["error"]} className="mb-4">
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

// Each person keeps one soft colour (from their name), the same on every screen.
const TONES = ["bg-[#3a2a1e] text-[#ffc9a0]", "bg-[#17352a] text-[#8febc0]", "bg-[#2a2740] text-[#c9c2ff]", "bg-[#3a2230] text-[#ffb8d4]", "bg-[#1e3040] text-[#a8d8ff]", "bg-[#33301a] text-[#f0dc8a]"];
export function avatarTone(name: string): string {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}
