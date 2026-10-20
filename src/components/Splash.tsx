// The opening screen: the Loopin ring with a dot going round it, shown while
// the app opens. On a slow connection it simply keeps going (and says so after
// a few seconds), then the app replaces it the moment it's ready. Never holds
// the app back on purpose.
export function Splash() {
  return (
    <div role="status" aria-label="Opening Loopin" className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-canvas">
      <div className="relative h-[120px] w-[120px]" aria-hidden>
        <span className="absolute inset-0 rounded-full bg-fg shadow-[0_24px_60px_rgba(0,0,0,0.6)]" />
        <span className="absolute inset-[28px] rounded-full bg-[#050506] shadow-[inset_0_8px_16px_rgba(0,0,0,0.9)]" />
        <span className="lp-orbit absolute inset-0">
          <span className="absolute left-1/2 top-[3px] h-[22px] w-[22px] -translate-x-1/2 rounded-full bg-owed shadow-[0_0_18px_rgba(111,227,168,0.55)]" />
        </span>
      </div>
      <p className="mt-8 font-display text-[44px] font-semibold leading-none tracking-tight" aria-hidden>
        loopin
      </p>
      <p className="lp-late mt-5 text-sm text-gray-500">Slow connection. Still opening…</p>
      <p className="absolute inset-x-0 bottom-[max(2.5rem,env(safe-area-inset-bottom))] text-center text-sm text-gray-500" aria-hidden>
        Everyone’s in. Everything adds up.
      </p>
    </div>
  );
}
