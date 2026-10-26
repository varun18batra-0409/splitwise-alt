import Image from "next/image";
import { isPhoto, photoSrc, type CoverChoice } from "@/lib/covers";

// A group's picture, drawn (see lib/covers.ts). Fills its box (give the parent
// a size and `relative`). `uid` keeps each copy's colour gradients separate,
// so several on one screen never borrow from a hidden one. "plain" shows the
// first letter of the name instead.
// Photos: `sizes` says how wide it shows (so the phone gets a small file),
// `priority` for the big picture at the top of a screen, `drift` for a slow zoom.
// For a group, pass {...coverFor(group)} (lib/covers.ts) for `kind` and `src`.
export function GroupCover({
  kind,
  uid,
  letter = "",
  small,
  className = "",
  sizes = "(max-width: 448px) 50vw, 224px",
  priority,
  drift,
  letterClass,
  src,
}: {
  kind: CoverChoice;
  uid: string;
  letter?: string;
  small?: boolean;
  className?: string;
  sizes?: string;
  priority?: boolean;
  drift?: boolean;
  letterClass?: string;
  src?: string;
}) {
  // The group's own photo (already made small on the phone that sent it).
  if (kind === "own") {
    if (!src) return null;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" aria-hidden loading={priority ? "eager" : "lazy"} decoding="async" className={`absolute inset-0 h-full w-full object-cover ${drift ? "lp-drift" : ""} ${className}`} />;
  }
  if (isPhoto(kind)) {
    const src = photoSrc(kind);
    if (src)
      return (
        <Image
          src={src}
          alt=""
          aria-hidden
          fill
          sizes={sizes}
          priority={priority}
          className={`object-cover ${drift ? "lp-drift" : ""} ${className}`}
        />
      );
    return null;
  }
  const id = (s: string) => `cv-${kind}-${s}-${uid.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const svg = (children: React.ReactNode) => (
    <svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" className={`absolute inset-0 block h-full w-full ${drift ? "lp-drift" : ""} ${className}`} aria-hidden>
      {children}
    </svg>
  );

  switch (kind) {
    case "plain":
      return (
        <span aria-hidden className={`absolute inset-0 flex bg-[radial-gradient(120%_80%_at_100%_0%,rgb(244_242_236/0.09),transparent_55%),linear-gradient(165deg,#1b1b20_0%,#111114_70%)] items-center justify-center font-display ${letterClass ?? (small ? "text-[32px]" : "text-[56px]")} font-semibold text-fg/80 ${className}`}>
          {letter.trim().charAt(0).toUpperCase()}
        </span>
      );
    case "beach":
      return svg(
        <>
          <defs>
            <linearGradient id={id("sky")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#1e1631" />
              <stop offset="0.42" stopColor="#7d3a5c" />
              <stop offset="0.66" stopColor="#e9845c" />
              <stop offset="0.72" stopColor="#ffc98b" />
            </linearGradient>
            <linearGradient id={id("sea")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3d3a5e" />
              <stop offset="1" stopColor="#0d1120" />
            </linearGradient>
            <radialGradient id={id("glow")} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#ffe2a8" stopOpacity="0.85" />
              <stop offset="1" stopColor="#ffe2a8" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="300" height="400" fill={`url(#${id("sky")})`} />
          <circle cx="190" cy="262" r="78" fill={`url(#${id("glow")})`} />
          <circle cx="190" cy="262" r="30" fill="#ffe6b0" />
          <rect y="268" width="300" height="132" fill={`url(#${id("sea")})`} />
          <g stroke="#ffd59a" strokeLinecap="round" opacity="0.75">
            <line x1="158" y1="282" x2="222" y2="282" strokeWidth="3" />
            <line x1="168" y1="296" x2="212" y2="296" strokeWidth="2.5" />
            <line x1="177" y1="311" x2="203" y2="311" strokeWidth="2" />
            <line x1="184" y1="327" x2="196" y2="327" strokeWidth="1.5" />
          </g>
          <g fill="#110c18">
            <path d="M58 400 C 62 330, 72 260, 98 196 L 105 199 C 80 262, 72 330, 71 400 Z" />
            <path d="M101 197 C 70 170, 30 172, 4 198 C 36 184, 70 187, 101 202 Z" />
            <path d="M101 197 C 92 160, 64 136, 28 131 C 60 148, 82 168, 98 202 Z" />
            <path d="M101 197 C 118 158, 150 146, 184 152 C 150 160, 124 176, 103 202 Z" />
            <path d="M101 197 C 136 186, 168 196, 188 222 C 160 205, 132 200, 103 203 Z" />
            <path d="M101 197 C 104 160, 96 130, 80 110 C 101 131, 109 162, 105 199 Z" />
          </g>
          <path d="M0 362 C 60 350, 140 352, 300 374 L 300 400 L 0 400 Z" fill="#0b0912" />
        </>,
      );
    case "city":
      return svg(
        <>
          <defs>
            <linearGradient id={id("sky")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0e1324" />
              <stop offset="0.5" stopColor="#26375e" />
              <stop offset="0.8" stopColor="#b8705a" />
              <stop offset="1" stopColor="#eaa874" />
            </linearGradient>
            <radialGradient id={id("moon")} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#f4ecd8" stopOpacity="0.5" />
              <stop offset="1" stopColor="#f4ecd8" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="300" height="400" fill={`url(#${id("sky")})`} />
          <circle cx="226" cy="84" r="44" fill={`url(#${id("moon")})`} />
          <circle cx="226" cy="84" r="14" fill="#f4ecd8" />
          <g fill="#1b2440">
            <rect x="0" y="210" width="52" height="190" />
            <rect x="46" y="240" width="44" height="160" />
            <rect x="118" y="186" width="46" height="214" />
            <rect x="198" y="222" width="52" height="178" />
            <rect x="248" y="198" width="52" height="202" />
          </g>
          <g fill="#0b0e1a">
            <rect x="0" y="262" width="70" height="138" />
            <rect x="64" y="198" width="64" height="202" />
            <rect x="126" y="282" width="48" height="118" />
            <rect x="168" y="232" width="72" height="168" />
            <rect x="236" y="272" width="64" height="128" />
          </g>
          <g fill="#ffc96b">
            {[
              [76, 214], [108, 214], [92, 236], [76, 258], [108, 280], [92, 302], [76, 324], [108, 346], [180, 248],
              [212, 248], [196, 270], [226, 292], [180, 314], [12, 278], [44, 300], [250, 288], [282, 310], [138, 298],
            ].map(([x, y]) => (
              <rect key={`${x}-${y}`} x={x} y={y} width="8" height="10" />
            ))}
          </g>
        </>,
      );
    case "couple":
      return svg(
        <>
          <defs>
            <linearGradient id={id("bg")} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#2e1823" />
              <stop offset="0.55" stopColor="#9a4348" />
              <stop offset="1" stopColor="#e8a57a" />
            </linearGradient>
          </defs>
          <rect width="300" height="400" fill={`url(#${id("bg")})`} />
          <circle cx="124" cy="206" r="72" fill="#f4e3cf" opacity="0.92" />
          <circle cx="178" cy="206" r="72" fill="none" stroke="#f4e3cf" strokeWidth="3" />
          <g fill="#f4e3cf">
            <circle cx="232" cy="96" r="3" />
            <circle cx="62" cy="318" r="2.5" />
            <circle cx="250" cy="320" r="2" />
            <circle cx="58" cy="104" r="2" />
          </g>
        </>,
      );
    case "dinner":
      return svg(
        <>
          <defs>
            <radialGradient id={id("bg")} cx="0.5" cy="0.45" r="0.75">
              <stop offset="0" stopColor="#244038" />
              <stop offset="1" stopColor="#0e1a17" />
            </radialGradient>
          </defs>
          <rect width="300" height="400" fill={`url(#${id("bg")})`} />
          <circle cx="92" cy="138" r="48" fill="#efe6d6" />
          <circle cx="92" cy="138" r="34" fill="#e3d7c3" />
          <circle cx="84" cy="132" r="12" fill="#c45b3c" />
          <circle cx="102" cy="146" r="9" fill="#7a9a4a" />
          <circle cx="212" cy="254" r="48" fill="#efe6d6" />
          <circle cx="212" cy="254" r="34" fill="#e3d7c3" />
          <circle cx="206" cy="248" r="14" fill="#d9a441" />
          <circle cx="222" cy="262" r="7" fill="#c45b3c" />
          <circle cx="96" cy="322" r="40" fill="#efe6d6" />
          <circle cx="96" cy="322" r="28" fill="#e3d7c3" />
          <circle cx="96" cy="322" r="11" fill="#7a9a4a" />
          <circle cx="222" cy="108" r="27" fill="#d8ccb6" />
          <circle cx="222" cy="108" r="18" fill="#a8452f" />
          <circle cx="158" cy="196" r="15" fill="none" stroke="#efe6d6" strokeWidth="3" opacity="0.8" />
          <circle cx="168" cy="340" r="12" fill="none" stroke="#efe6d6" strokeWidth="3" opacity="0.8" />
        </>,
      );
    case "mountain":
      return svg(
        <>
          <defs>
            <linearGradient id={id("sky")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#7f9fc2" />
              <stop offset="0.55" stopColor="#e4b796" />
              <stop offset="1" stopColor="#f6d2ae" />
            </linearGradient>
          </defs>
          <rect width="300" height="400" fill={`url(#${id("sky")})`} />
          <circle cx="204" cy="168" r="24" fill="#fff1d6" />
          <path d="M0 250 L 60 180 L 104 222 L 160 150 L 222 230 L 262 196 L 300 226 L 300 400 L 0 400 Z" fill="#7d8eac" />
          <path d="M0 286 L 48 236 L 100 278 L 150 214 L 214 286 L 262 248 L 300 270 L 300 400 L 0 400 Z" fill="#45567a" />
          <path d="M0 330 L 70 272 L 130 320 L 190 268 L 250 318 L 300 296 L 300 400 L 0 400 Z" fill="#232d46" />
          <path d="M0 372 C 80 344, 200 350, 300 366 L 300 400 L 0 400 Z" fill="#111726" />
        </>,
      );
    case "cards":
      return svg(
        <>
          <defs>
            <radialGradient id={id("felt")} cx="0.5" cy="0.55" r="0.75">
              <stop offset="0" stopColor="#1f6b4a" />
              <stop offset="0.6" stopColor="#124a33" />
              <stop offset="1" stopColor="#0a2a1e" />
            </radialGradient>
          </defs>
          <rect width="300" height="400" fill={`url(#${id("felt")})`} />
          <ellipse cx="150" cy="210" rx="128" ry="150" fill="none" stroke="#2f8a62" strokeWidth="2" opacity="0.6" />
          <g transform="translate(108 206) rotate(-16)">
            <rect x="-46" y="-66" width="92" height="132" rx="10" fill="#f6f1e6" stroke="#d9cfbd" strokeWidth="2" />
            <text x="-32" y="-36" fontSize="26" fontWeight="700" fill="#1b1b1f" fontFamily="Georgia, serif">A</text>
            <text x="0" y="16" fontSize="54" textAnchor="middle" fill="#1b1b1f">♠</text>
          </g>
          <g transform="translate(150 190) rotate(0)">
            <rect x="-46" y="-66" width="92" height="132" rx="10" fill="#f6f1e6" stroke="#d9cfbd" strokeWidth="2" />
            <text x="-32" y="-36" fontSize="26" fontWeight="700" fill="#c0392b" fontFamily="Georgia, serif">K</text>
            <text x="0" y="16" fontSize="54" textAnchor="middle" fill="#c0392b">♥</text>
          </g>
          <g transform="translate(194 206) rotate(16)">
            <rect x="-46" y="-66" width="92" height="132" rx="10" fill="#f6f1e6" stroke="#d9cfbd" strokeWidth="2" />
            <text x="-32" y="-36" fontSize="26" fontWeight="700" fill="#c0392b" fontFamily="Georgia, serif">Q</text>
            <text x="0" y="16" fontSize="54" textAnchor="middle" fill="#c0392b">♦</text>
          </g>
          {/* A little stack of chips */}
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <ellipse cx="226" cy={330 - i * 9} rx="24" ry="8" fill={["#d9a441", "#c45b3c", "#efe6d6"][i]} stroke="#0a2a1e" strokeWidth="1.5" />
            </g>
          ))}
          <ellipse cx="78" cy="334" rx="22" ry="7.5" fill="#d9a441" stroke="#0a2a1e" strokeWidth="1.5" />
        </>,
      );
    case "diwali":
      return svg(
        <>
          <defs>
            <radialGradient id={id("bg")} cx="0.5" cy="0.68" r="0.7">
              <stop offset="0" stopColor="#4a2410" />
              <stop offset="0.55" stopColor="#22110f" />
              <stop offset="1" stopColor="#120a10" />
            </radialGradient>
            <radialGradient id={id("glow")} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#ffcf6b" stopOpacity="0.75" />
              <stop offset="1" stopColor="#ffcf6b" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={id("flame")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff4c2" />
              <stop offset="0.6" stopColor="#ffbf47" />
              <stop offset="1" stopColor="#ff7a2e" />
            </linearGradient>
          </defs>
          <rect width="300" height="400" fill={`url(#${id("bg")})`} />
          <path d="M0 34 Q 150 96 300 34" fill="none" stroke="#6b3a1c" strokeWidth="1.5" />
          {[22, 54, 88, 122, 150, 178, 212, 246, 278].map((x, i) => (
            <circle key={x} cx={x} cy={[44, 56, 65, 70, 71, 70, 65, 56, 44][i]} r="7" fill={i % 2 ? "#ffc93c" : "#f28c28"} />
          ))}
          <circle cx="150" cy="252" r="92" fill={`url(#${id("glow")})`} />
          <path d="M150 214 C 163 240, 167 258, 150 278 C 133 258, 137 240, 150 214 Z" fill={`url(#${id("flame")})`} />
          <path d="M92 284 Q 150 346 208 284 Z" fill="#c9672e" />
          <ellipse cx="150" cy="284" rx="58" ry="7" fill="#e3893f" />
          <g fill="#ffd27a">
            <circle cx="64" cy="170" r="2" />
            <circle cx="236" cy="150" r="2.5" />
            <circle cx="250" cy="236" r="1.6" />
            <circle cx="44" cy="262" r="1.8" />
            <circle cx="206" cy="118" r="1.4" />
            <circle cx="96" cy="128" r="1.4" />
          </g>
        </>,
      );
    default:
      return null;
  }
}
