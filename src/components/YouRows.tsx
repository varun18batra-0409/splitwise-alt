import Link from "@/components/Link";

// The rounded lists on the You page: a line icon, a title, one short line and a chevron. Hairline between rows.
// Only links, so this is a plain server component.

const base = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const WalletLineIcon = () => (
  <svg {...base}>
    <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" />
    <path d="M4 7.5V17a2 2 0 0 0 2 2h12.5a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 8H6.5A2.5 2.5 0 0 1 4 7.5Z" />
    <path d="M16 13.5h.01" />
  </svg>
);
export const LockLineIcon = () => (
  <svg {...base}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </svg>
);
export const DevicesLineIcon = () => (
  <svg {...base}>
    <rect x="4.5" y="5" width="15" height="10.5" rx="1.5" />
    <path d="M2.5 19h19" />
  </svg>
);
export const DownloadLineIcon = () => (
  <svg {...base}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
  </svg>
);
export const HelpLineIcon = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="8.75" />
    <path d="M9.6 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8M12 16.6h.01" />
  </svg>
);
export const PostcardLineIcon = () => (
  <svg {...base}>
    <rect x="2.5" y="5" width="19" height="14" rx="1.5" />
    <path d="M12 8v8M15 9h3.5v3.5H15zM5.5 10h4M5.5 13h4" />
  </svg>
);

export function YouList({ label, children, className = "" }: { label?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={className} aria-label={label}>
      {label && <h2 className="mb-2 px-1 font-display text-lg font-semibold tracking-tight">{label}</h2>}
      <ul className="divide-y divide-line overflow-hidden rounded-[20px] border border-line bg-white">{children}</ul>
    </section>
  );
}

// `hook` keeps the test hooks the old account page had on these links.
export function YouRow({ href, icon, title, line, hook }: { href: string; icon: React.ReactNode; title: string; line: string; hook?: "postcards" | "notify" }) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-14 items-center gap-3.5 px-4 py-3 active:bg-mist"
        data-postcards-link={hook === "postcards" ? "" : undefined}
        data-notify-link={hook === "notify" ? "" : undefined}
      >
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[#1f1f24] text-fg/75">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium leading-tight">{title}</span>
          <span className="mt-0.5 block text-[13px] leading-snug text-fg/55">{line}</span>
        </span>
        <span aria-hidden className="text-xl text-fg/55">
          ›
        </span>
      </Link>
    </li>
  );
}
