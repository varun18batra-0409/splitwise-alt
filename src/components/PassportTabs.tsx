import Link from "@/components/Link";

// The passport's header art and its tab switch.
//
// To add a tab later (Want to go): add it to `PASSPORT_TABS` with its label and make the page draw it.
// The switch only appears once there is more than one, so a lone "Been" never looks like a choice.
export type PassportTab = "been" | "want";
export const PASSPORT_TABS: { id: PassportTab; label: string }[] = [{ id: "been", label: "Been" }];

export function passportTab(raw: string | undefined): PassportTab {
  return PASSPORT_TABS.some((t) => t.id === raw) ? (raw as PassportTab) : "been";
}

// A little leather passport, drawn (the booklet's cover in small: dark, off-white foil, a globe).
export function PassportArt() {
  return (
    <svg aria-hidden width="104" height="104" viewBox="0 0 104 104" fill="none" className="pointer-events-none absolute right-0 top-0 hidden opacity-90 min-[360px]:block" data-passport-art>
      <g transform="rotate(14 60 52)">
        <rect x="34" y="8" width="54" height="76" rx="5" fill="#16161a" stroke="#f4f2ec" strokeOpacity="0.25" />
        <rect x="34" y="8" width="6" height="76" rx="3" fill="#0d0d0f" />
        <text x="63" y="30" textAnchor="middle" fontSize="7.5" fontWeight="600" letterSpacing="1.6" fill="#f4f2ec" fillOpacity="0.55" style={{ fontFamily: "var(--font-display), serif" }}>
          PASSPORT
        </text>
        <g stroke="#f4f2ec" strokeOpacity="0.55" strokeWidth="1.1">
          <circle cx="63" cy="52" r="13" />
          <ellipse cx="63" cy="52" rx="5.5" ry="13" />
          <path d="M50 52h26M52 44h22M52 60h22" />
        </g>
      </g>
    </svg>
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
