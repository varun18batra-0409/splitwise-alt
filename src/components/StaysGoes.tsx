import type { StaysGoes as Text } from "@/lib/leave-text";

// A short, closed-by-default "What stays / What goes" note above a leave, remove or delete button.
export function StaysGoes({ text, label = "What stays, what goes" }: { text: Text; label?: string }) {
  const list = "mt-1.5 space-y-1 text-xs leading-snug text-gray-500";
  return (
    <details className="group/sg mb-3 rounded-2xl border border-line px-4 py-3" data-stays-goes>
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm text-gray-500 [&::-webkit-details-marker]:hidden">
        {label}
        <span aria-hidden className="text-gray-400 transition-transform group-open/sg:rotate-90">›</span>
      </summary>
      <div className="mt-3 space-y-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-owed">What stays</p>
          <ul className={list}>
            {text.stays.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{text.goesTitle}</p>
          <ul className={list}>
            {text.goes.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        {text.extra && <p className="text-xs text-gray-400">{text.extra}</p>}
      </div>
    </details>
  );
}
