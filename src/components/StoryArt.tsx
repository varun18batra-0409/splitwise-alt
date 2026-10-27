// Designed pictures for the stories that have no photo of their own: a card
// game on green felt with gold, a collection jar filling with coins, an "all
// square" seal, a trip at dusk, a memory, a Wrapped reel. Drawn, not stock
// photos, so they're sharp on every phone and look like Loopin.

import type { StoryKind } from "@/lib/home/stories";

const GOLD = "#d8bd7a";
const FOIL = "#ece8dc";
const CARD = "#f6f1e4";
const INK = "#17150f";
const RED = "#b23a2c";

function Card({ x, y, r, rank, suit, red, id }: { x: number; y: number; r: number; rank: string; suit: string; red?: boolean; id: string }) {
  const c = red ? RED : INK;
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <rect x="-52" y="-74" width="104" height="148" rx="9" fill="#000" opacity="0.35" transform="translate(5 8)" filter={`url(#${id}-blur)`} />
      <rect x="-52" y="-74" width="104" height="148" rx="9" fill={CARD} />
      <rect x="-46" y="-68" width="92" height="136" rx="6" fill="none" stroke={GOLD} strokeOpacity="0.55" strokeWidth="1" />
      <text x="-38" y="-44" fill={c} fontFamily="var(--font-display), Georgia, serif" fontWeight="600" fontSize="24">
        {rank}
      </text>
      <text x="-38" y="-24" fill={c} fontSize="17">
        {suit}
      </text>
      <text x="0" y="22" textAnchor="middle" fill={c} fontSize="56">
        {suit}
      </text>
      <g transform="rotate(180)">
        <text x="-38" y="-44" fill={c} fontFamily="var(--font-display), Georgia, serif" fontWeight="600" fontSize="24">
          {rank}
        </text>
      </g>
    </g>
  );
}

function Chip({ x, y, fill }: { x: number; y: number; fill: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {[0, 1, 2, 3].map((k) => (
        <g key={k} transform={`translate(0 ${-k * 7})`}>
          <ellipse cx="0" cy="0" rx="24" ry="9" fill={fill} stroke={GOLD} strokeWidth="1.2" />
          <ellipse cx="0" cy="-1" rx="15" ry="5" fill="none" stroke={FOIL} strokeOpacity="0.5" strokeDasharray="3 3" />
        </g>
      ))}
    </g>
  );
}

export function StoryArt({ kind, uid, className = "" }: { kind: StoryKind; uid: string; className?: string }) {
  const id = `art-${uid.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const svg = (children: React.ReactNode, defs?: React.ReactNode) => (
    <svg aria-hidden viewBox="0 0 360 640" preserveAspectRatio="xMidYMid slice" className={`absolute inset-0 h-full w-full ${className}`}>
      <defs>
        <filter id={`${id}-blur`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id={`${id}-grain`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.09 0" />
        </filter>
        {defs}
      </defs>
      {children}
      <rect width="360" height="640" filter={`url(#${id}-grain)`} />
    </svg>
  );

  if (kind === "pot")
    return svg(
      <>
        <rect width="360" height="640" fill={`url(#${id}-felt)`} />
        <ellipse cx="180" cy="300" rx="250" ry="330" fill="none" stroke={GOLD} strokeOpacity="0.3" strokeWidth="2" />
        <ellipse cx="180" cy="300" rx="232" ry="312" fill="none" stroke={GOLD} strokeOpacity="0.18" strokeDasharray="2 6" />
        <Card x={118} y={250} r={-17} rank="A" suit={"\u2660\uFE0E"} id={id} />
        <Card x={180} y={232} r={0} rank="K" suit={"\u2665\uFE0E"} red id={id} />
        <Card x={242} y={250} r={17} rank="Q" suit={"\u2666\uFE0E"} red id={id} />
        <Chip x={92} y={420} fill="#14140f" />
        <Chip x={142} y={432} fill="#7a2a22" />
        <Chip x={270} y={426} fill="#1d4a7a" />
      </>,
      <radialGradient id={`${id}-felt`} cx="50%" cy="38%" r="75%">
        <stop offset="0%" stopColor="#1f6e4c" />
        <stop offset="55%" stopColor="#11432e" />
        <stop offset="100%" stopColor="#06180f" />
      </radialGradient>,
    );

  if (kind === "collect")
    return svg(
      <>
        <rect width="360" height="640" fill={`url(#${id}-bg)`} />
        <circle cx="180" cy="300" r="170" fill={`url(#${id}-glow)`} />
        {/* The jar: glass outline, a lid, coins inside, a few on their way in. */}
        <g transform="translate(180 320)">
          <path d="M-78 -92 h156 v18 q34 16 34 64 v120 q0 40 -40 40 h-144 q-40 0 -40 -40 v-120 q0 -48 34 -64 z" fill={`url(#${id}-fill)`} />
          <path d="M-78 -92 h156 v18 q34 16 34 64 v120 q0 40 -40 40 h-144 q-40 0 -40 -40 v-120 q0 -48 34 -64 z" fill="none" stroke={FOIL} strokeOpacity="0.8" strokeWidth="2.5" />
          <rect x="-86" y="-118" width="172" height="26" rx="7" fill="#26262c" stroke={GOLD} strokeWidth="2" />
          <path d="M-90 -40 q-4 60 0 120" stroke={FOIL} strokeOpacity="0.25" strokeWidth="6" strokeLinecap="round" fill="none" />
          {[
            [-60, 108],
            [-20, 112],
            [22, 108],
            [62, 110],
            [-40, 86],
            [2, 88],
            [44, 86],
            [-18, 64],
            [24, 66],
          ].map(([x, y], k) => (
            <g key={k}>
              <ellipse cx={x} cy={y} rx="20" ry="8" fill={GOLD} />
              <ellipse cx={x} cy={y - 1.5} rx="13" ry="4.5" fill="none" stroke="#8a6f35" strokeWidth="1.2" />
            </g>
          ))}
        </g>
        {[
          [150, 150, -20],
          [214, 116, 25],
        ].map(([x, y, r], k) => (
          <g key={k} transform={`translate(${x} ${y}) rotate(${r})`}>
            <circle r="17" fill={GOLD} />
            <circle r="11" fill="none" stroke="#8a6f35" strokeWidth="1.5" />
            <text y="5.5" textAnchor="middle" fontSize="15" fontWeight="700" fill="#5e4a1f">
              ₹
            </text>
          </g>
        ))}
      </>,
      <>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1d1d22" />
          <stop offset="100%" stopColor="#0b0b0d" />
        </linearGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0%" stopColor={GOLD} stopOpacity="0.22" />
          <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6fe3a8" stopOpacity="0" />
          <stop offset="45%" stopColor="#6fe3a8" stopOpacity="0" />
          <stop offset="46%" stopColor="#6fe3a8" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#6fe3a8" stopOpacity="0.3" />
        </linearGradient>
      </>,
    );

  if (kind === "square")
    return svg(
      <>
        <rect width="360" height="640" fill={`url(#${id}-bg)`} />
        <g transform="translate(180 290)">
          {Array.from({ length: 24 }, (_, k) => (
            <circle key={k} cx={Math.sin((k * Math.PI) / 12) * 118} cy={-Math.cos((k * Math.PI) / 12) * 118} r="14" fill="#123826" />
          ))}
          <circle r="118" fill="#123826" />
          <circle r="104" fill="none" stroke={GOLD} strokeWidth="2" />
          <circle r="94" fill="none" stroke={GOLD} strokeOpacity="0.45" strokeDasharray="2 5" />
          <path d="M-42 2 l28 28 l58 -62" fill="none" stroke="#6fe3a8" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </>,
      <radialGradient id={`${id}-bg`} cx="50%" cy="40%" r="80%">
        <stop offset="0%" stopColor="#1b3a2c" />
        <stop offset="100%" stopColor="#08110c" />
      </radialGradient>,
    );

  if (kind === "wrapped")
    return svg(
      <>
        <rect width="360" height="640" fill="#101013" />
        {[0, 1, 2, 3, 4].map((k) => (
          <rect key={k} x={-200 + k * 46} y="-100" width="22" height="900" fill={k % 2 ? GOLD : "#6fe3a8"} opacity={0.08 + k * 0.03} transform="rotate(28 180 320)" />
        ))}
        <circle cx="180" cy="300" r="70" fill="none" stroke={FOIL} strokeWidth="2.5" />
        <path d="M164 268 L210 300 L164 332 Z" fill={FOIL} />
      </>,
    );

  if (kind === "memory")
    return svg(
      <>
        <rect width="360" height="640" fill={`url(#${id}-bg)`} />
        {[
          [-9, 0],
          [6, 10],
        ].map(([r, d], k) => (
          <g key={k} transform={`translate(${180 + d} ${290 + d}) rotate(${r})`}>
            <rect x="-110" y="-130" width="220" height="250" fill={CARD} />
            <rect x="-96" y="-116" width="192" height="180" fill={k ? "#c98a5a" : "#8a5a3a"} opacity={k ? 0.9 : 0.6} />
          </g>
        ))}
        <circle cx="210" cy="215" r="34" fill="#f2c58a" opacity="0.9" />
        <path d="M84 340 q60 -70 110 -20 q40 -40 80 10 v34 h-190 z" fill="#5a3826" />
      </>,
      <radialGradient id={`${id}-bg`} cx="50%" cy="35%" r="80%">
        <stop offset="0%" stopColor="#3a2a20" />
        <stop offset="100%" stopColor="#0f0b08" />
      </radialGradient>,
    );

  // A trip at dusk: sky, sun on the horizon, a plane's dotted path.
  return svg(
    <>
      <rect width="360" height="640" fill={`url(#${id}-sky)`} />
      <circle cx="180" cy="420" r="70" fill="#f6c27a" opacity="0.95" />
      <rect y="420" width="360" height="220" fill="#191520" />
      <path d="M40 210 q140 -120 290 -40" fill="none" stroke={FOIL} strokeOpacity="0.7" strokeWidth="2" strokeDasharray="3 8" strokeLinecap="round" />
      <path d="M322 168 l14 -2 l-6 12 z" fill={FOIL} />
    </>,
    <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#1c1830" />
      <stop offset="55%" stopColor="#6a3d5c" />
      <stop offset="66%" stopColor="#e2865c" />
    </linearGradient>,
  );
}
