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
