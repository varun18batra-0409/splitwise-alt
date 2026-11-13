// One family of thin line icons (24px grid, 1.6 stroke) used across the app.

type P = { size?: number; className?: string };

function Svg({ size = 22, className, children }: P & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 10.5 12 3.5l8.5 7" />
    <path d="M5.5 9.5V20h13V9.5" />
    <path d="M10 20v-5h4v5" />
  </Svg>
);

export const PersonIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.75" />
    <path d="M4.5 20c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
  </Svg>
);

export const BellIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15L6 16.5Z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </Svg>
);

export const GearIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.1M12 19.1v2.1M21.2 12h-2.1M4.9 12H2.8M18.5 5.5 17 7M7 17l-1.5 1.5M18.5 18.5 17 17M7 7 5.5 5.5" />
  </Svg>
);

export const InviteIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="9.5" cy="8" r="3.5" />
    <path d="M3 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5" />
    <path d="M19 8v6M16 11h6" />
  </Svg>
);

export const PlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const GroupIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="8.5" r="3" />
    <circle cx="16.5" cy="9.5" r="2.4" />
    <path d="M3.5 19c.5-3 2.8-4.8 5.5-4.8s5 1.8 5.5 4.8" />
    <path d="M15 14.4c2.6-.2 4.6 1.4 5.2 4.6" />
  </Svg>
);

export const SettleIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 8h13l-3.5-3.5" />
    <path d="M20 16H7l3.5 3.5" />
  </Svg>
);

export const ChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const BackIcon = (p: P) => (
  <Svg {...p}>
    <path d="M15 5 8 12l7 7" />
  </Svg>
);

// A round, quiet icon button for headers.
export const SearchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.4-4.4" />
  </Svg>
);

// Insights: a small bar chart.
export const ChartIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 20V12" />
    <path d="M10 20V6" />
    <path d="M15 20v-9" />
    <path d="M20 20V4" />
  </Svg>
);

export const ChevronRight = (p: P) => (
  <Svg {...p}>
    <path d="m9 5 7 7-7 7" />
  </Svg>
);

// A small line tick (a person's payment is in), drawn, never a ✓ glyph.
export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);

export const LinkIcon = (p: P) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
);

export const CalendarIcon = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="5.5" width="16" height="14.5" rx="3" />
    <path d="M8 3.5v4M16 3.5v4M4 10.5h16" />
  </Svg>
);

// The four tiles on a flat's overview.
export const BillsIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 3.5h12v17l-2.5-1.6-1.8 1.6-1.7-1.6-1.7 1.6-1.8-1.6L6 20.5z" />
    <path d="M9.5 8.5h5M9.5 12h5" />
  </Svg>
);
export const CartIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 4h2.2l2 11h10.2l1.8-8H6.2" />
    <circle cx="9" cy="19.5" r="1.1" />
    <circle cx="16.5" cy="19.5" r="1.1" />
  </Svg>
);
export const PieIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z" />
    <path d="M15 3.8a8.5 8.5 0 0 1 5.2 5.2H15z" />
  </Svg>
);
export const DepositIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v10M8 10.5l4 4 4-4" />
    <path d="M4.5 15.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" />
  </Svg>
);

export const iconButtonClass =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-fg/10 bg-fg/[0.06] text-fg/85 backdrop-blur transition-transform active:scale-95 active:bg-fg/10";
