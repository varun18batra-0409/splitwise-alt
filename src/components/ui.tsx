import Link from "next/link";

// Small shared building blocks so every screen looks the same.

export function PageHeader({
  title,
  back,
  action,
}: {
  title: string;
  back?: string;
  action?: { href: string; label: string; icon: string };
}) {
  return (
    <header className="mb-8 flex items-center gap-3">
      {back && (
        <Link
          href={back}
          aria-label="Back"
          className="-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-2xl text-gray-500 active:bg-gray-100"
        >
          ‹
        </Link>
      )}
      <h1 className="min-w-0 flex-1 truncate font-display text-2xl font-semibold tracking-tight">{title}</h1>
      {action && (
        <Link
          href={action.href}
          aria-label={action.label}
          className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl text-gray-500 active:bg-gray-100"
        >
          {action.icon}
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
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-dark">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
