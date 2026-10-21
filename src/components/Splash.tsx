// The opening screen: the Loopin logo (the same as the app icon, so the phone's
// own launch screen flows straight into it), with the green part going round
// the grey ring while the app opens. On a slow connection it keeps going (and
// says so after a few seconds).
export function Splash() {
  return (
    <div role="status" aria-label="Opening Loopin" className="fixed inset-0 z-[70] flex items-center justify-center bg-canvas">
      <svg viewBox="0 0 512 512" width="176" height="176" aria-hidden className="block">
        <circle cx="256" cy="256" r="164" fill="none" stroke="#2b2b31" strokeWidth="24" />
        <g className="lp-orbit" style={{ transformOrigin: "256px 256px" }}>
          {/* a quarter of the ring, starting at the top */}
          <circle
            cx="256"
            cy="256"
            r="164"
            fill="none"
            stroke="#6fe3a8"
            strokeWidth="24"
            strokeLinecap="round"
            strokeDasharray="268 1100"
            transform="rotate(-90 256 256)"
          />
        </g>
        <text x="256" y="330" textAnchor="middle" fill="#f4f2ec" fontSize="210" fontWeight="600" style={{ fontFamily: "var(--font-fraunces), Georgia, serif" }}>
          L
        </text>
      </svg>
      <p className="lp-late absolute inset-x-0 top-[calc(50%+110px)] text-center text-sm text-gray-500">Slow connection. Still opening…</p>
      <p className="absolute inset-x-0 bottom-[max(2.5rem,env(safe-area-inset-bottom))] text-center text-sm text-gray-500" aria-hidden>
        Everyone’s in. Everything adds up.
      </p>
    </div>
  );
}
