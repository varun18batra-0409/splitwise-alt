"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { setAiConsentAction } from "@/app/ai-actions";

export type AiWhat = "line" | "bill photo";

// The calm question before anything goes to the AI for the first time. Resolves true only when "Allow" was saved.
// "Not now" is saved too (as no), so Loopin doesn't keep asking; it can be changed any time on the You page.
export function useAiConsent() {
  const [what, setWhat] = useState<AiWhat | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((yes: boolean) => void) | null>(null);

  const ask = useCallback(
    (w: AiWhat) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setWhat(w);
      }),
    [],
  );

  async function answer(yes: boolean) {
    setBusy(true);
    let saved = false;
    try {
      saved = (await setAiConsentAction(yes ? "yes" : "no")).ok;
    } catch {
      // offline: nothing is sent this time
    }
    setBusy(false);
    setWhat(null);
    const r = resolver.current;
    resolver.current = null;
    r?.(yes && saved);
  }

  const sheet =
    what && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="ai-consent-title"
              data-ai-consent
              className="sheet-enter w-full max-w-md rounded-t-[28px] border-t border-line bg-canvas px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 text-fg"
            >
              <span aria-hidden className="mx-auto mb-4 block h-1 w-10 rounded-full bg-fg/20" />
              <p id="ai-consent-title" className="font-display text-xl font-semibold tracking-tight">
                Let Loopin’s AI read this?
              </p>
              <p className="mt-2 text-sm leading-relaxed text-fg/65">
                To fill in the expense, Loopin sends this {what} and your group’s first names to Anthropic, an AI company, which doesn’t use it to train its models. You can change this any time in You → Privacy.
              </p>
              <button type="button" disabled={busy} onClick={() => void answer(true)} data-ai-allow className="pop mt-5 block w-full bg-fg px-5 py-3.5 text-center text-base font-semibold text-canvas disabled:opacity-60">
                Allow
              </button>
              <button type="button" disabled={busy} onClick={() => void answer(false)} data-ai-decline className="mt-2 block min-h-12 w-full rounded-full px-5 text-center text-base font-medium text-fg/70 active:bg-mist disabled:opacity-60">
                Not now
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return { ask, sheet };
}
