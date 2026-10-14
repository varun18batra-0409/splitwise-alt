import Link from "next/link";

// Small shared building blocks so every screen looks the same.

export function PageHeader({ title, back }: { title: string; back?: string }) {
  return (
    <header className="mb-8 flex items-center gap-3">
      {back && (
        <Link
          href={back}
          aria-label="Back"
          className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-2xl text-gray-500 active:bg-gray-100"
        >
          ‹
        </Link>
      )}
      <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
    </header>
  );
}

export const inputClass =
  "w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

export const primaryButtonClass =
  "w-full rounded-xl bg-accent px-4 py-3.5 text-center text-base font-semibold text-white active:bg-accent-dark disabled:opacity-50";

export const secondaryButtonClass =
  "w-full rounded-xl border border-gray-200 px-4 py-3.5 text-center text-base font-medium text-gray-800 active:bg-gray-50";

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
