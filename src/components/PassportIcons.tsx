// Small drawn line icons for the passport tabs (one stroke weight, currentColor, same family as DrawnIcons).

type P = { size?: number; className?: string };
const base = (size: number, className = "") => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, className });

export const CalendarIcon = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
    <path d="M4 10h16M8 3.5v4M16 3.5v4M8.5 14h.01M12 14h.01M15.5 14h.01M8.5 17h.01M12 17h.01" />
  </svg>
);

export const PeopleIcon = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5" />
    <path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.4c1.8.6 3.1 2.2 3.5 4.6" />
  </svg>
);

export const PhotoIcon = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4 17 5-4.5 3.5 3 3-2.5 4.5 4" />
  </svg>
);

export const ShareIcon = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M12 3.5v12M7.5 8 12 3.5 16.5 8" />
    <path d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12" />
  </svg>
);

export const InfoIcon = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="8.75" />
    <path d="M12 11v5.2M12 7.8h.01" />
  </svg>
);

export const LockIcon = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5M12 14.2v2.2" />
  </svg>
);

export const DotsIcon = ({ size = 18, className }: P) => (
  <svg {...base(size, className)} fill="currentColor" stroke="none">
    <circle cx="5.5" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="18.5" cy="12" r="1.6" />
  </svg>
);

export const AddIcon = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

// One simple line icon per passport badge (no emoji): same stroke family as the rest.
const BADGE_PATHS: Record<string, string> = {
  "first-abroad": "M21 15.5v-1.7l-7.6-4.7V3.8c0-.8-.6-1.5-1.4-1.5s-1.4.7-1.4 1.5v5.3L3 13.8v1.7l7.6-2.2v4.9l-2 1.5v1.4l3.4-.9 3.4.9v-1.4l-2-1.5v-4.9Z",
  beach: "M4 19h16M12 19V9M5 10a7 7 0 0 1 14 0Z",
  hills: "m3 19 6-10 4 6 2-3 6 7Z",
  city: "M5 20V8h6v12M11 20V4h8v16M3 20h18M8 11h0M8 14h0M14 8h2M14 12h2M14 16h2",
  cities: "M4 20V11h5v9M9 20V6h6v14M15 20v-8h5v8M3 20h18",
  countries: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM3.5 12h17M12 3.5c2.4 2.4 3.4 5.3 3.4 8.5s-1 6.1-3.4 8.5c-2.4-2.4-3.4-5.3-3.4-8.5s1-6.1 3.4-8.5Z",
  frequent: "M3 17h18M5 13l3-5h4l-1 5M14 13l5-6",
  year: "M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .3 1.2 1 2 2 2 0-3-.5-5 1-8Z",
  trips: "M12 4.5l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 9.7l5-.7Z",
};
export const BadgeIcon = ({ id, size = 20, className }: P & { id: string }) => (
  <svg {...base(size, className)} data-badge-icon={id}>
    <path d={BADGE_PATHS[id] ?? "M12 4.5l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 9.7l5-.7Z"} />
  </svg>
);
