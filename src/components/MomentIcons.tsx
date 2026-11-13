// Drawn line icons for Moments (24px grid, thin strokes, off-white): no emoji in Loopin's own words.
type P = { size?: number; className?: string };

function Svg({ size = 22, className, children }: P & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {children}
    </svg>
  );
}

export const CameraIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);

export const CameraPlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 8h3l2-3h6l2 3h3v6" />
    <path d="M4 8v11h9" />
    <circle cx="11" cy="13" r="3.25" />
    <path d="M19 16v6M16 19h6" />
  </Svg>
);

export const SavedIcon = (p: P) => (
  <Svg {...p}>
    <path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8.5a4.75 4.75 0 0 1 0 9.5z" />
    <path d="m9.5 13 2 2 3.5-3.5" />
  </Svg>
);

export const DotsIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="19" cy="12" r="1" fill="currentColor" />
  </Svg>
);

export const ChevronRightIcon = (p: P) => (
  <Svg {...p}>
    <path d="m9 5 7 7-7 7" />
  </Svg>
);

export const PlusSmallIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
