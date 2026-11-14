import type { ReactNode } from "react";

// Small shared pieces of the postcard editor: the look of chips, tiles and panels, and the tool icons.
// Dark Loopin surfaces only (#0d0d0f / #16161a / #1f1f24, off-white text). No orange or green anywhere in the editor's own look.

// A pill choice. 44 px tall so it is easy to hit.
export const chip = (on: boolean) =>
  `inline-flex h-11 shrink-0 items-center rounded-full border px-4 text-[13.5px] font-semibold transition-transform active:scale-95 motion-reduce:transition-none ${on ? "border-fg bg-mist text-fg shadow-[inset_0_0_0_0.5px_var(--color-fg)]" : "border-fg/20 bg-transparent text-fg/85"}`;

// A picture choice (photo, look, print).
export const tile = (on: boolean) =>
  `relative shrink-0 overflow-hidden rounded-[8px] transition-transform active:scale-95 motion-reduce:transition-none ${on ? "outline outline-2 outline-offset-2 outline-fg" : "opacity-90"}`;

// A strip that scrolls sideways (long lists). Runs to the panel's edges.
export function Strip({ children, className = "", ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`-mx-3.5 flex gap-2 overflow-x-auto py-1.5 pl-3.5 pr-10 [scrollbar-width:none] [mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent)] ${className}`} {...rest}>
      {children}
    </div>
  );
}

// The options panel for one tool: it sits right above the tool row. Long panels scroll inside themselves, never the page.
export function Panel({ tool, label, children, action }: { tool: string; label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section aria-label={label} data-panel={tool} className="max-h-[40svh] flex-none overflow-y-auto rounded-[18px] border border-fg/10 bg-[#16161a] px-3.5 py-3">
      <div className="mb-1 flex min-h-6 items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold">{label}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// A small caption above one group of choices in a strip.
export const caption = "mb-1 block text-[11px] text-fg/60";

// A slider row with a label and its value. The whole row is 44 px tall.
export function SliderRow({ label, value, unit = "%", children }: { label: string; value: number; unit?: string; children: ReactNode }) {
  return (
    <label className="flex h-11 items-center gap-3">
      <span className="w-[72px] shrink-0 text-[12.5px] font-semibold text-fg/70">{label}</span>
      {children}
      <span className="w-10 text-right text-[13px] tabular-nums text-fg/70">
        {value}
        {unit}
      </span>
    </label>
  );
}

const svg = (children: ReactNode, size = 20) => (
  <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const Icons: Record<string, ReactNode> = {
  photo: svg(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 16l5-5 4 4 3-3 6 6" /></>),
  look: svg(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  words: svg(<><path d="M5 6h14" /><path d="M12 6v13" /></>),
  lettering: (
    <span aria-hidden className="font-display text-[18px] leading-5">
      Aa
    </span>
  ),
  colour: svg(<path d="M12 3c3.5 4.5 6 7.7 6 10.5A6 6 0 0 1 6 13.5C6 10.7 8.5 7.5 12 3z" />),
  touchesFront: svg(<><path d="M4 9l7-5 9 9-5 7-11-11z" /><path d="M8 7l9 9" /></>),
  message: svg(<path d="M4 7h16M4 12h16M4 17h10" />),
  pen: svg(<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13 7l4 4" /></>),
  paper: svg(<><rect x="3" y="6" width="18" height="12" rx="1.5" /><path d="M13 10h5M13 13h5" /></>),
  stamp: (
    <svg aria-hidden width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 2">
      <rect x="5" y="3" width="14" height="18" rx="1" />
    </svg>
  ),
  seal: svg(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4.5" /></>),
  touches: svg(<><circle cx="12" cy="12" r="7" /><path d="M12 5a7 7 0 0 1 6 10" /></>),
  flip: svg(<><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 21v-5h5" /></>, 18),
  back: svg(<path d="M15 18l-6-6 6-6" />, 20),
  home: svg(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>, 20),
  plus: svg(<path d="M12 5v14M5 12h14" />, 16),
  check: svg(<path d="M5 12l5 5 9-10" />, 14),
};
