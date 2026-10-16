// Shown the moment you tap anything, while the next screen loads. Without it
// the old screen just sits there, which feels like the app is stuck. It also
// lets Next.js fetch each screen once per tap instead of twice.
export default function Loading() {
  const bar = "rounded-lg bg-mist motion-safe:animate-pulse";
  return (
    <div aria-busy="true" aria-label="Loading" className="pt-2">
      <span className="sr-only">Loading…</span>
      <div className={`h-9 w-2/3 ${bar}`} />
      <div className={`mt-8 h-4 w-1/3 ${bar}`} />
      <div className={`mt-3 h-10 w-3/4 ${bar}`} />
      <div className="mt-10 space-y-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className={`h-10 w-10 shrink-0 rounded-full bg-mist motion-safe:animate-pulse`} />
            <div className="flex-1 space-y-2">
              <div className={`h-4 w-1/2 ${bar}`} />
              <div className={`h-3 w-1/3 ${bar}`} />
            </div>
            <div className={`h-4 w-16 ${bar}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
