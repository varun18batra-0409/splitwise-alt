// Outlines of a screen, shown the moment you tap while the real one is on its
// way (so a tap always changes the screen at once). Shapes only, no words.
const bar = "lp-skel rounded-lg";

export function ScreenSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="lp-skel h-10 w-10 rounded-full" />
        <div className={`${bar} h-7 w-40`} />
      </div>
      <div className={`${bar} h-24 rounded-[20px]`} />
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="lp-skel h-10 w-10 rounded-xl" />
            <div className="flex-1 space-y-2">
              <div className={`${bar} h-4 w-2/3`} />
              <div className={`${bar} h-3 w-1/3`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GroupSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="lp-skel -mx-5 -mt-[max(1.5rem,env(safe-area-inset-top))] mb-6 h-[232px]" />
      <div className={`${bar} h-4 w-24`} />
      <div className={`${bar} mt-2 h-9 w-56`} />
      <div className="lp-skel mt-6 h-12 rounded-xl" />
      <div className="mt-6 space-y-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="lp-skel h-10 w-10 rounded-xl" />
            <div className="flex-1 space-y-2">
              <div className={`${bar} h-4 w-1/2`} />
              <div className={`${bar} h-3 w-1/3`} />
            </div>
            <div className={`${bar} h-4 w-16`} />
          </div>
        ))}
      </div>
    </div>
  );
}
