import Link from "@/components/Link";
import { BackIcon, HomeIcon, iconButtonClass } from "./icons";

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
    <header className="mb-8 flex items-center gap-3">
      {back && (
        <Link href={back} aria-label="Back" className={iconButtonClass}>
          <BackIcon size={20} />
        </Link>
      )}
      <h1 className="min-w-0 flex-1 truncate font-display text-2xl font-semibold tracking-tight">{title}</h1>
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
  "w-full rounded-xl border border-line bg-mist px-4 py-3 text-base text-fg outline-none placeholder:text-gray-400 focus:border-accent focus:ring-2 focus:ring-accent/20";

// NeoPOP: square, off-white, with a hard edge that presses in.
export const primaryButtonClass =
  "pop block w-full bg-fg px-4 py-3.5 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63] disabled:opacity-50";

export const secondaryButtonClass =
  "block w-full border border-line px-4 py-3.5 text-center text-base font-medium text-fg active:bg-mist";

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{children}</p>
  );
}

export function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-mist font-display text-sm font-semibold text-fg">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
