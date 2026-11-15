"use client";

import { LOOKS, LOOK_PICKS, PLACES, TOUCHES, TOUCH_PICKS, lookCss } from "@/lib/postcards/looks";
import { LETTERINGS, LETTERING_PICKS, TONES, TONE_PICKS, printSvg } from "@/lib/postcards/catalog";
import { Panel, SliderRow, Strip, chip, tile } from "./shared";

// The tools for the front of the card. Every tap changes the card at once.

export function LookPanel({ look, setLook, src, front }: { look: string; setLook: (l: string) => void; src: string; front: string }) {
  const [lookId, lookAmt] = [look.split(":")[0] || "none", Number(look.split(":")[1] ?? 100)];
  return (
    <Panel tool="look" label="Look">
      <Strip data-looks>
        {LOOK_PICKS.map((id) => LOOKS.find((l) => l.id === id)!).map((l) => {
          const on = lookId === l.id;
          const spec = l.id === "none" ? "" : `${l.id}:100`;
          return (
            <button key={l.id} type="button" onClick={() => setLook(l.id === "none" ? "" : `${l.id}:${on ? lookAmt : 80}`)} aria-label={`Look: ${l.name}`} aria-pressed={on} data-look-choice={l.id} className="flex w-[78px] shrink-0 flex-col items-center gap-1">
              <span className={`${tile(on)} block h-[52px] w-[78px] bg-mist`}>
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" style={{ filter: lookCss(spec) }} />
                ) : front.startsWith("print:") ? (
                  <span aria-hidden className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full" style={{ filter: lookCss(spec) }} dangerouslySetInnerHTML={{ __html: printSvg(front.slice(6), `lk${l.id}`) }} />
                ) : null}
              </span>
              <span className={`text-[11px] ${on ? "text-fg" : "text-fg/65"}`}>{l.name}</span>
            </button>
          );
        })}
      </Strip>
      {lookId !== "none" && (
        <SliderRow label="How strong" value={lookAmt}>
          <input type="range" min={10} max={100} step={5} value={lookAmt} onChange={(e) => setLook(`${lookId}:${e.target.value}`)} aria-label="How strong the look is" className="h-1 min-w-0 flex-1 accent-[#F4F2EC]" />
        </SliderRow>
      )}
    </Panel>
  );
}

export function WordsPanel({ words, setWords, custom, setCustom, options, wordsAt, setWordsAt, wordsSize, setWordsSize }: {
  words: string;
  setWords: (w: string) => void;
  custom: boolean;
  setCustom: (c: boolean) => void;
  options: string[];
  wordsAt: string;
  setWordsAt: (a: string) => void;
  wordsSize: number;
  setWordsSize: (n: number) => void;
}) {
  return (
    <Panel tool="words" label="Words">
      <Strip>
        {options.map((w) => (
          <button key={w} type="button" className={chip(!custom && words === w)} aria-pressed={!custom && words === w} onClick={() => (setCustom(false), setWords(w))}>
            {w}
          </button>
        ))}
        <button type="button" className={chip(custom)} aria-pressed={custom} onClick={() => setCustom(true)}>
          Your own
        </button>
        <button type="button" className={chip(!custom && words === "")} aria-pressed={!custom && words === ""} onClick={() => (setCustom(false), setWords(""))}>
          None
        </button>
      </Strip>
      {custom && (
        <input value={words} onChange={(e) => setWords(e.target.value.slice(0, 24))} autoFocus placeholder="e.g. the villa that flooded" aria-label="Words on the front" className="mb-1 mt-1 h-11 w-full rounded-[12px] border border-line bg-mist px-3.5 text-base outline-none focus:border-fg/40" />
      )}
      {words && (
        <>
          <div className="flex items-start gap-1.5" data-words-place>
            <span className="flex h-11 w-[72px] shrink-0 items-center text-[12.5px] font-semibold text-fg/70">Sits at</span>
            <div className="flex min-w-0 flex-wrap gap-1.5 py-0.5" data-chip-row>
            {PLACES.map((p) => (
              <button key={p.id} type="button" className={`${chip(wordsAt === p.id)} !px-3.5`} onClick={() => setWordsAt(p.id)} aria-pressed={wordsAt === p.id}>
                {p.name}
              </button>
            ))}
            </div>
          </div>
          <SliderRow label="Size" value={wordsSize}>
            <input type="range" min={60} max={150} step={5} value={wordsSize} onChange={(e) => setWordsSize(Number(e.target.value))} aria-label="Size of the words" className="h-1 min-w-0 flex-1 accent-[#F4F2EC]" data-words-size />
          </SliderRow>
        </>
      )}
    </Panel>
  );
}

export function LetteringPanel({ lettering, setLettering }: { lettering: string; setLettering: (l: string) => void }) {
  return (
    <Panel tool="lettering" label="Lettering">
      <Strip data-letterings>
        {LETTERING_PICKS.map((id) => LETTERINGS.find((l) => l.id === id)!).map((l) => (
          <button key={l.id} type="button" className={chip(lettering === l.id)} aria-pressed={lettering === l.id} onClick={() => setLettering(l.id)} style={{ fontFamily: `'${l.family}', serif`, fontStyle: l.italic ? "italic" : undefined, fontSize: l.caps ? 13 : 15, fontWeight: 400 }}>
            {l.name}
          </button>
        ))}
      </Strip>
    </Panel>
  );
}

export function ColourPanel({ tone, setTone }: { tone: string; setTone: (t: string) => void }) {
  return (
    <Panel tool="colour" label="Colour">
      <Strip data-tones>
        {TONE_PICKS.map((id) => TONES.find((t) => t.id === id)!).map((t) => (
          <button key={t.id} type="button" onClick={() => setTone(t.id)} aria-label={`${t.name} words`} aria-pressed={tone === t.id} data-tone-choice={t.id} className="flex min-h-[56px] w-[58px] shrink-0 flex-col items-center justify-center gap-1">
            <span aria-hidden className={`block size-8 rounded-full border border-fg/20 shadow-[inset_0_-3px_6px_rgba(0,0,0,0.25)] transition-transform active:scale-95 motion-reduce:transition-none ${tone === t.id ? "outline outline-2 outline-offset-[3px] outline-fg" : ""}`} style={{ background: t.c }} />
            <span className={`text-[11px] ${tone === t.id ? "text-fg" : "text-fg/65"}`}>{t.name}</span>
          </button>
        ))}
      </Strip>
    </Panel>
  );
}

// Touches on one side of the card. `side` front: tape, flower and the brought-back stickers; back: coffee ring and par avion.
// One side: the few that fit it. The wax seal is chosen in its own tool.
export function TouchesPanel({ side, touches, toggle, ids }: { side: "front" | "back"; touches: string[]; toggle: (id: string) => void; ids?: string[] }) {
  const list = TOUCHES.filter((t) => (ids ? ids.includes(t.id) : t.side === side && (TOUCH_PICKS as readonly string[]).includes(t.id) && t.id !== "seal"));
  return (
    <Panel tool="touches" label="Touches">
      <Strip {...(side === "front" ? { "data-touches-front": "" } : { "data-touches-back": "" })}>
        {list.map((t) => (
          <button key={t.id} type="button" className={chip(touches.includes(t.id))} aria-pressed={touches.includes(t.id)} onClick={() => toggle(t.id)}>
            {t.name}
          </button>
        ))}
      </Strip>
    </Panel>
  );
}
