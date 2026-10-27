// Loopin's own small drawn icons (one stroke weight, currentColor), used where
// an emoji used to stand in for an icon. They look the same on every phone.

type P = { size?: number; className?: string };
const base = (size: number, className = "") => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, className });

export function PassportIcon({ size = 18, className }: P) {
  return (
    <svg {...base(size, className)}>
      <rect x="5" y="2.75" width="14" height="18.5" rx="2" />
      <circle cx="12" cy="10.5" r="3.4" />
      <path d="M8.6 10.5h6.8M12 7.1c1 1 1.4 2.1 1.4 3.4S13 12.9 12 13.9c-1-1-1.4-2.1-1.4-3.4S11 8.1 12 7.1M9 17.5h6" />
    </svg>
  );
}

export function CompassIcon({ size = 18, className }: P) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="m15.5 8.5-2 5-5 2 2-5Z" />
    </svg>
  );
}

export function PeoplePassportsIcon({ size = 18, className }: P) {
  return (
    <svg {...base(size, className)}>
      <rect x="3" y="4.5" width="11" height="15" rx="1.8" />
      <path d="M17 6.5h2a1.8 1.8 0 0 1 1.8 1.8v10.4A1.8 1.8 0 0 1 19 20.5h-7.5" />
      <circle cx="8.5" cy="10.5" r="2.6" />
      <path d="M6 16h5" />
    </svg>
  );
}

export function CalendarClockIcon({ size = 14, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M20 11V6.5A1.5 1.5 0 0 0 18.5 5h-13A1.5 1.5 0 0 0 4 6.5v12A1.5 1.5 0 0 0 5.5 20H11M4 9.5h16M8 3v4M16 3v4" />
      <circle cx="17" cy="17" r="4" />
      <path d="M17 15.3V17l1.2.8" />
    </svg>
  );
}

export function BellIcon({ size = 20, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M6 9a6 6 0 0 1 12 0c0 6.5 2.5 8 2.5 8h-17S6 15.5 6 9M10.3 20.5a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export function TrophyIcon({ size = 28, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0ZM7.5 6H4.5v1.5A3 3 0 0 0 7.6 10.5M16.5 6h3v1.5a3 3 0 0 1-3.1 3M12 13.5V17M8.5 20.5h7M9.5 20.5c0-2 1-3.5 2.5-3.5s2.5 1.5 2.5 3.5" />
    </svg>
  );
}

// "All square": a gold-rimmed seal with a green tick that draws itself in.
export function SquareSeal({ size = 64, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden className={className}>
      <circle cx="32" cy="32" r="29" fill="#123826" stroke="#d8bd7a" strokeWidth="1.6" />
      <circle cx="32" cy="32" r="24.5" stroke="#d8bd7a" strokeOpacity="0.4" strokeDasharray="1.5 3" />
      <path d="M21 32.5l7.5 7.5L44 24.5" stroke="#6fe3a8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="lp-draw-tick" style={{ "--len": 34 } as React.CSSProperties} />
    </svg>
  );
}
