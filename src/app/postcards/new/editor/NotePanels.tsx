"use client";

import { useState } from "react";
import { HANDS, HAND_PICKS, INKS, INK_PICKS, OPENERS, PAPERS, PAPER_PICKS, paperTones, stampSvg } from "@/lib/postcards/catalog";
import { SEAL_COLOURS, SEAL_COLOUR_PICKS, SEAL_DESIGNS, SEAL_DESIGN_PICKS, waxSeal } from "@/lib/postcards/looks";
import { MESSAGE_MAX, overText, withOpener } from "@/lib/postcards/fit";
import { ONESIDE_MAX, type Format } from "@/lib/postcards/format";
import { Panel, Strip, chip } from "./shared";

// The tools for the note (the back of the card, or the note on a one-side card).

export function MessagePanel({ format, message, setMessage, over, nudge, signoff, setSignoff, myFirst, hand, ink, addr, setAddr, onFocus, onBlur }: {
  format: Format;
  message: string;
  setMessage: (m: string) => void;
  over: number; // lines too many on a classic card
  nudge: string;
  signoff: string;
  setSignoff: (s: string) => void;
  myFirst: string;
  hand: string;
  ink: string;
  addr: string[];
  setAddr: (a: string[]) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const [showAddr, setShowAddr] = useState(addr.some(Boolean));
  const one = format === "oneside";
  const max = one ? ONESIDE_MAX : MESSAGE_MAX;
  const tooLong = one ? message.length > ONESIDE_MAX : over > 0;
  return (
    <Panel tool="message" label="Message" action={<span className={`text-[12.5px] tabular-nums ${tooLong ? "text-red-600" : "text-fg/70"}`} data-message-count>{`${message.length} / ${max}`}</span>}>
      <Strip>
        {OPENERS.map((o) => (
          <button key={o} type="button" className={chip(false)} onClick={() => setMessage(withOpener(message, o))}>
            {o.trim().replace(/ $/, "")}
            {o.endsWith(" ") ? "…" : ""}
          </button>
        ))}
      </Strip>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
        onFocus={onFocus}
        onBlur={onBlur}
        rows={3}
        aria-label="Your message"
        placeholder="Write something they’ll want to keep…"
        className="mt-1 block w-full resize-none rounded-[12px] border border-line bg-[#f4eee2] px-3.5 py-2.5 text-[18px] leading-snug text-[#2b2a5a] outline-none placeholder:text-[#2b2a5a]/50"
        style={{ fontFamily: `'${HANDS.find((h) => h.id === hand)?.family}', cursive`, color: INKS.find((i) => i.id === ink)?.c }}
      />
      <p className={`mt-1 min-h-5 text-[12.5px] leading-snug ${tooLong ? "text-red-600" : "text-fg/70"}`} role="status" data-message-over={tooLong ? "" : undefined} data-next-status>
        {nudge || (tooLong ? (one ? `A one-side card holds up to ${ONESIDE_MAX} characters. Take a few out.` : overText(over)) : "")}
      </p>
      <label className="flex h-11 items-center justify-between gap-4 border-b border-line">
        <span className="text-[14px] font-semibold">From</span>
        <input value={signoff} onChange={(e) => setSignoff(e.target.value.slice(0, 25))} maxLength={25} placeholder={myFirst || "Your name"} aria-label="Signed" data-signoff className="h-11 min-w-0 flex-1 bg-transparent text-right text-[15px] text-fg/85 outline-none placeholder:text-fg/60 focus:text-fg" />
      </label>
      {!one && (
        <>
          <button type="button" onClick={() => setShowAddr((s) => !s)} aria-expanded={showAddr} className="flex h-11 w-full items-center justify-between text-left text-[14px] font-semibold">
            Add an address
            <span aria-hidden className="text-fg/60">{showAddr ? "−" : "+"}</span>
          </button>
          {showAddr && (
            <div className="space-y-2 pb-1">
              {[0, 1, 2].map((i) => (
                <input
                  key={i}
                  value={addr[i] ?? ""}
                  onChange={(e) => {
                    const next = [...addr];
                    next[i] = e.target.value.slice(0, 25);
                    setAddr(next);
                  }}
                  placeholder={["Their name", "Flat 4B, Rose Villa", "Bengaluru"][i]}
                  maxLength={25}
                  aria-label={`Address line ${i + 1}`}
                  className="h-11 w-full rounded-[12px] border border-line bg-mist px-3.5 text-base outline-none focus:border-fg/40"
                />
              ))}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

// Handwriting and ink together.
export function PenPanel({ hand, setHand, ink, setInk }: { hand: string; setHand: (h: string) => void; ink: string; setInk: (i: string) => void }) {
  const inkName = INKS.find((i) => i.id === ink)?.name ?? "";
  return (
    <Panel tool="pen" label="Pen">
      <Strip data-hands>
        {HAND_PICKS.map((hp) => {
          const h = HANDS.find((x) => x.id === hp.id)!;
          return (
            <button key={h.id} type="button" onClick={() => setHand(h.id)} aria-label={`${hp.name} handwriting`} aria-pressed={hand === h.id} className={`flex h-11 shrink-0 items-center justify-center gap-2 rounded-[12px] border px-3.5 text-[13px] transition-transform active:scale-95 motion-reduce:transition-none ${hand === h.id ? "border-fg bg-mist font-semibold text-fg" : "border-fg/20 text-fg/85"}`}>
              <span aria-hidden className="text-[20px] leading-none" style={{ fontFamily: `'${h.family}', cursive` }}>Aa</span>
              {hp.name}
            </button>
          );
        })}
      </Strip>
      <p className="mt-1 text-[12.5px] text-fg/70">
        <span className="font-semibold">Ink</span> · {inkName}
      </p>
      <Strip data-inks>
        {INK_PICKS.map((id) => INKS.find((i) => i.id === id)!).map((i) => (
          <button key={i.id} type="button" onClick={() => setInk(i.id)} aria-label={`${i.name} ink`} aria-pressed={ink === i.id} data-ink-choice={i.id} className="flex size-11 shrink-0 items-center justify-center">
            <span aria-hidden className={`block size-[30px] rounded-full border border-fg/20 transition-transform active:scale-90 motion-reduce:transition-none ${ink === i.id ? "outline outline-2 outline-offset-[3px] outline-fg" : ""}`} style={{ background: i.c }} />
          </button>
        ))}
      </Strip>
    </Panel>
  );
}

export function PaperPanel({ paper, setPaper }: { paper: string; setPaper: (p: string) => void }) {
  return (
    <Panel tool="paper" label="Paper">
      <Strip data-papers>
        {PAPER_PICKS.map((id) => PAPERS.find((p) => p.id === id)!).map((p) => {
          const [a, b, c] = paperTones(p.id);
          return (
            <button key={p.id} type="button" onClick={() => setPaper(p.id)} aria-label={`${p.name} paper`} aria-pressed={paper === p.id} data-paper-choice={p.id} className="flex min-h-[56px] w-[62px] shrink-0 flex-col items-center justify-center gap-1">
              <span aria-hidden className={`block h-9 w-[54px] rounded-[3px] shadow-[0_3px_8px_-3px_rgba(0,0,0,0.6)] transition-transform active:scale-95 motion-reduce:transition-none ${paper === p.id ? "outline outline-2 outline-offset-[3px] outline-fg" : ""}`} style={{ background: p.id === "airmail" ? `repeating-linear-gradient(-45deg,#c8453a 0 5px,${a} 5px 10px,#2f5fa7 10px 15px,${a} 15px 20px)` : `radial-gradient(120% 90% at 0% 0%,${a},${b} 70%,${c})` }} />
              <span className={`text-[11px] ${paper === p.id ? "text-fg" : "text-fg/65"}`}>{p.name}</span>
            </button>
          );
        })}
      </Strip>
    </Panel>
  );
}

const stampLabel = (id: string) => {
  const n = id.replace(/^r:/, "").split("@")[0];
  return n.charAt(0).toUpperCase() + n.slice(1);
};

export function StampPanel({ stamp, setStamp, list, rare }: { stamp: string; setStamp: (s: string) => void; list: string[]; rare: { id: string; until: string }[] }) {
  const rareIds = rare.map((r) => r.id);
  return (
    <Panel tool="stamp" label="Stamp">
      {rare.length > 0 && (
        <p className="mb-0.5 text-[12px] leading-snug text-fg/70" data-rare-note>
          Limited stamps on issue now: {rare.map((r) => `${stampLabel(r.id)} until ${r.until}`).join(", ")}. They go in your stamp album.
        </p>
      )}
      <Strip data-stamps className="gap-2.5">
        {list.map((s) => (
          <button key={s} type="button" onClick={() => setStamp(s)} aria-pressed={stamp === s} className={`min-h-11 shrink-0 rounded-[4px] p-0.5 transition-transform active:scale-95 motion-reduce:transition-none ${stamp === s ? "outline outline-2 outline-offset-2 outline-fg" : ""}`} aria-label={`Stamp ${s}`} data-stamp-choice={s}>
            <span aria-hidden className="block w-[46px] [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: stampSvg(s, `c${s}`) }} />
            {rareIds.includes(s) && <span className="mt-1 block text-center text-[10.5px] font-semibold text-fg/65">Limited</span>}
          </button>
        ))}
      </Strip>
    </Panel>
  );
}

// The wax seal: on or off, its colour and its design. Choosing a colour or design puts the seal on (the saved data is the same as
// before: "seal" among the touches, and the colour:design pair).
export function SealPanel({ on, setOn, seal, setSeal, name }: { on: boolean; setOn: (on: boolean) => void; seal: string; setSeal: (s: string) => void; name: string }) {
  const [col, des] = [seal.split(":")[0] || "crimson", seal.split(":")[1] || "initial"];
  const pick = (next: string) => {
    setSeal(next);
    setOn(true);
  };
  return (
    <Panel
      tool="seal"
      label="Wax seal"
      action={
        <button type="button" onClick={() => setOn(false)} aria-pressed={!on} data-seal-off className={`${chip(!on)} !h-11 !px-3.5`}>
          No seal
        </button>
      }
    >
      <div data-seal-picker>
        <Strip data-wax-colours>
          {SEAL_COLOUR_PICKS.map((id) => SEAL_COLOURS.find((c) => c.id === id)!).map((c) => {
            const sel = on && col === c.id;
            return (
              <button key={c.id} type="button" onClick={() => pick(`${c.id}:${des}`)} aria-label={`${c.name} wax`} aria-pressed={sel} className="flex min-h-[60px] w-[58px] shrink-0 flex-col items-center justify-center gap-0.5">
                <span aria-hidden className={`block w-[38px] rounded-full transition-transform active:scale-90 motion-reduce:transition-none [&>svg]:h-auto [&>svg]:w-full ${sel ? "outline outline-2 outline-offset-2 outline-fg" : ""}`} dangerouslySetInnerHTML={{ __html: waxSeal(`${c.id}:${des}`, name, `pc${c.id}`) }} />
                <span className={`truncate text-[10.5px] ${sel ? "text-fg" : "text-fg/65"}`}>{c.name}</span>
              </button>
            );
          })}
        </Strip>
        <Strip data-wax-designs>
          {SEAL_DESIGN_PICKS.map((id) => SEAL_DESIGNS.find((d) => d.id === id)!).map((d) => {
            const sel = on && des === d.id;
            return (
              <button key={d.id} type="button" onClick={() => pick(`${col}:${d.id}`)} aria-label={`Seal design: ${d.name}`} aria-pressed={sel} className="flex min-h-[60px] w-[58px] shrink-0 flex-col items-center justify-center gap-0.5">
                <span aria-hidden className={`block w-[38px] rounded-full transition-transform active:scale-90 motion-reduce:transition-none [&>svg]:h-auto [&>svg]:w-full ${sel ? "outline outline-2 outline-offset-2 outline-fg" : ""}`} dangerouslySetInnerHTML={{ __html: waxSeal(`${col}:${d.id}`, name, `pd${d.id}`) }} />
                <span className={`text-center text-[10.5px] leading-tight ${sel ? "text-fg" : "text-fg/65"}`}>{d.name}</span>
              </button>
            );
          })}
        </Strip>
      </div>
    </Panel>
  );
}
