"use client";

import Link from "@/components/Link";
import { Icons } from "./shared";

export type Step = "front" | "back" | "send";

// Back (to the step before, or out of the editor from the first one), the steps, Home. The steps are tabs: tap one to go there.
// In the Send step the page title shows and the steps sit under it.
export function TopBar({ title, steps, step, onStep, onBack, backHref, visibleTitle = false, error }: {
  title: string;
  steps: { id: Step; name: string }[];
  step: Step;
  onStep: (s: Step) => void;
  onBack: () => void;
  backHref: string;
  visibleTitle?: boolean;
  error?: string;
}) {
  const circle = "flex size-11 shrink-0 items-center justify-center rounded-full border border-fg/15 bg-[#16161a] text-fg active:scale-95";
  const at = steps.findIndex((s) => s.id === step);
  const tabs = (
    <div role="tablist" aria-label="Postcard steps" className="flex items-center justify-center gap-1">
      {steps.map((s, n) => (
        <span key={s.id} role="presentation" className="flex items-center gap-1">
          {n > 0 && <span aria-hidden className="h-px w-3 bg-fg/30" />}
          <button type="button" role="tab" aria-selected={step === s.id} onClick={() => onStep(s.id)} data-step={s.id} className="flex h-11 items-center px-0.5 text-[13px] font-semibold">
            <span className={`flex h-7 items-center gap-1.5 rounded-full px-3 ${step === s.id ? "bg-fg text-canvas" : n < at ? "text-fg/85" : "text-fg/60"}`}>
              {n < at && <span aria-hidden className="text-fg/85">{Icons.check}</span>}
              {s.name}
            </span>
          </button>
        </span>
      ))}
    </div>
  );
  const back =
    at === 0 ? (
      <Link href={backHref} aria-label="Back" className={circle}>
        {Icons.back}
      </Link>
    ) : (
      <button type="button" onClick={onBack} aria-label="Back" className={circle}>
        {Icons.back}
      </button>
    );
  return (
    <header className="flex-none">
      <div className="flex items-center justify-between gap-2">
        {back}
        {visibleTitle ? <h1 className="min-w-0 flex-1 truncate px-1 font-display text-[22px] font-semibold tracking-[-0.01em] min-[360px]:text-[26px]">{title}</h1> : (<><h1 className="sr-only">{title}</h1>{tabs}</>)}
        <Link href="/" aria-label="Home" className={circle}>
          {Icons.home}
        </Link>
      </div>
      {visibleTitle && <div className="mt-3">{tabs}</div>}
      {error && (
        <p role="alert" className="mt-1 text-center text-[13px] leading-snug text-red-600">
          {error}
        </p>
      )}
    </header>
  );
}
