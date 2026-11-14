import Link from "@/components/Link";

// The passport's header art and its tab switch.
//
// Tabs: Been (stamps) and Want to go (a private list of places). To add one, put it in `PASSPORT_TABS` and make the page draw it.
// The switch only appears once there is more than one, so a lone "Been" never looks like a choice.
export type PassportTab = "been" | "want";
export const PASSPORT_TABS: { id: PassportTab; label: string }[] = [
  { id: "been", label: "Been" },
  { id: "want", label: "Want to go" },
];

export function passportTab(raw: string | undefined): PassportTab {
  return PASSPORT_TABS.some((t) => t.id === raw) ? (raw as PassportTab) : "been";
}

// A little leather passport (the book's cover in small: deep red leather, off-white foil, a globe). It is the way into the book:
// a 44 px or bigger tap target, smaller on the narrowest phones rather than hidden.
export function PassportArt() {
  return (
    <Link href="/passport?book=1" aria-label="Open your passport book" className="absolute right-0 top-0 flex h-[76px] w-[70px] items-center justify-center rounded-[14px] active:opacity-70 min-[360px]:h-[104px] min-[360px]:w-[104px]" data-passport-art>
      <svg aria-hidden width="100%" height="100%" viewBox="0 0 104 104" fill="none" className="pointer-events-none">
        <g transform="rotate(14 60 52)">
          <rect x="34" y="8" width="54" height="76" rx="5" fill="#4a1a24" stroke="#f4f2ec" strokeOpacity="0.25" />
          <rect x="34" y="8" width="6" height="76" rx="3" fill="#2e0f16" />
          <text x="64" y="30" textAnchor="middle" fontSize="7.5" fontWeight="600" letterSpacing="1.6" fill="#ece8dc" fillOpacity="0.75" style={{ fontFamily: "var(--font-display), serif" }}>
            PASSPORT
          </text>
          <g stroke="#ece8dc" strokeOpacity="0.7" strokeWidth="1.1">
            <circle cx="63" cy="52" r="13" />
            <ellipse cx="63" cy="52" rx="5.5" ry="13" />
            <path d="M50 52h26M52 44h22M52 60h22" />
          </g>
        </g>
      </svg>
    </Link>
  );
}

// The two-segment switch. The chosen side gets the 1.5px off-white outline, never a fill.
export function PassportTabs({ tab }: { tab: PassportTab }) {
  if (PASSPORT_TABS.length < 2) return null;
  return (
    <nav aria-label="Passport" className="mb-4 grid gap-1 rounded-full border border-fg/25 p-1" style={{ gridTemplateColumns: `repeat(${PASSPORT_TABS.length}, minmax(0, 1fr))` }} data-passport-tabs>
      {PASSPORT_TABS.map((t) => {
        const on = t.id === tab;
        return (
          <Link
            key={t.id}
            href={t.id === "been" ? "/passport" : `/passport?tab=${t.id}`}
            aria-current={on ? "page" : undefined}
            className={`flex h-11 items-center justify-center rounded-full px-2 text-[15px] ${on ? "font-semibold text-fg shadow-[inset_0_0_0_1.5px_var(--color-fg)]" : "text-fg/55"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
