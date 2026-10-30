"use client";

import { useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { PostcardBack, PostcardFront } from "@/components/postcards/Card";
import { shrink } from "@/components/OwnPhoto";
import { avatarTone } from "@/components/ui";
import { buzz } from "@/lib/haptics";
import { COUNTRY_STAMP_IDS, HANDS, LETTERINGS, OPENERS, PAPERS, PRINTS, THEME_STAMP_IDS, printSvg, stampSvg } from "@/lib/postcards/catalog";
import { sendPostcardAction } from "@/app/postcard-actions";
import type { PostcardGroup } from "@/lib/postcards/people";

type Props = {
  groupId: string;
  groups: PostcardGroup[];
  photos: string[];
  words: string[];
  defaults: { front: string; words: string; stamp: string; place: string; to: string[] };
  myName: string;
  date: string;
};

// Write a postcard: the card itself stays on top and turns as you go (front, then back), with the
// choices underneath. Send goes to the people you tick.
export function Composer({ groupId, groups, photos, words: wordOptions, defaults, myName, date }: Props) {
  const [tab, setTab] = useState<"front" | "back" | "send">("front");
  const [front, setFront] = useState(defaults.front);
  const [own, setOwn] = useState<{ url: string; data: string } | null>(null);
  const [words, setWords] = useState(defaults.words);
  const [custom, setCustom] = useState(false);
  const [lettering, setLettering] = useState("classic");
  const [message, setMessage] = useState("");
  const [hand, setHand] = useState("caveat");
  const [stamp, setStamp] = useState(defaults.stamp);
  const [paper, setPaper] = useState("cream");
  const [to, setTo] = useState<string[]>(defaults.to);
  const [addr, setAddr] = useState<string[]>(["", "", ""]);
  const [photoState, setPhotoState] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const everyone = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const p of g.people) if (!m.has(p.id)) m.set(p.id, p.name);
    return m;
  }, [groups]);
  const firstOf = (n: string) => n.trim().split(/\s+/)[0] || n;
  // With one person picked, the first address line is their name (until you type your own).
  const address = addr[0] || to.length !== 1 ? addr : [firstOf(everyone.get(to[0]) ?? ""), addr[1], addr[2]];
  const stampList = useMemo(() => [...new Set([stamp, ...COUNTRY_STAMP_IDS, ...THEME_STAMP_IDS])], [stamp]);

  const frontProps = { front, photo: front === "own" ? own?.url : undefined, words, lettering, k: "cf" };
  const backProps = { message: message || "Your words here…", hand, stamp, paper, address, place: defaults.place, date, from: firstOf(myName) || "Me", k: "cb" };

  async function pickPhoto(file?: File) {
    if (!file) return;
    setPhotoState("Getting it ready…");
    try {
      const blob = await shrink(file);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      setOwn({ url: URL.createObjectURL(blob), data: btoa(bin) });
      setFront("own");
      setPhotoState("");
      buzz("tap");
    } catch (e) {
      setPhotoState(e instanceof Error ? e.message : "Couldn’t use that photo.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  const toggle = (id: string) => setTo((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const showBack = tab !== "front";
  const tile = (on: boolean) => `relative shrink-0 overflow-hidden rounded-[6px] transition-transform active:scale-95 ${on ? "outline outline-2 outline-offset-2 outline-fg" : "opacity-85"}`;
  const label = "mb-2.5 mt-6 block text-[13px] font-semibold text-fg/55";
  const chip = (on: boolean) => `inline-flex h-9 shrink-0 items-center rounded-full border px-4 text-[13.5px] font-semibold transition-transform active:scale-95 ${on ? "border-fg bg-fg text-canvas" : "border-line bg-mist text-fg/85"}`;

  return (
    <form action={sendPostcardAction} data-allow-repeat="1">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="front" value={front} />
      {front === "own" && own && <input type="hidden" name="photo" value={own.data} />}
      <input type="hidden" name="words" value={words} />
      <input type="hidden" name="lettering" value={lettering} />
      <input type="hidden" name="hand" value={hand} />
      <input type="hidden" name="stamp" value={stamp} />
      <input type="hidden" name="paper" value={paper} />
      <input type="hidden" name="place" value={defaults.place} />
      <input type="hidden" name="message" value={message} />
      {address.map((a, i) => (
        <input key={i} type="hidden" name={`addr${i}`} value={a} />
      ))}
      {to.map((id) => (
        <input key={id} type="hidden" name="to" value={id} />
      ))}

      {/* The card, turning as you move from front to back. */}
      <div className="sticky top-[max(0.5rem,env(safe-area-inset-top))] z-20 -mx-1 pb-3">
        <button type="button" onClick={() => setTab(showBack ? "front" : "back")} aria-label={showBack ? "Show the front" : "Show the back"} className="block w-full [perspective:1600px]" data-composer-card={showBack ? "back" : "front"}>
          <div className="relative transition-transform duration-[800ms] ease-[cubic-bezier(.2,.8,.2,1)] [transform-style:preserve-3d] motion-reduce:transition-none" style={{ transform: showBack ? "rotateY(180deg)" : "none" }}>
            <div className="[backface-visibility:hidden]">
              <PostcardFront {...frontProps} />
            </div>
            <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
              <PostcardBack {...backProps} />
            </div>
          </div>
        </button>
      </div>

      <div className="mx-auto mt-2 grid max-w-[320px] grid-cols-3 gap-1 rounded-full bg-mist p-1" role="tablist" aria-label="Postcard steps">
        {(
          [
            ["front", "Front"],
            ["back", "Back"],
            ["send", "Send"],
          ] as const
        ).map(([id, l]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-full py-2 text-sm font-semibold ${tab === id ? "bg-fg text-canvas" : "text-fg/55"}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "front" && (
        <section aria-label="Front">
          <span className={label}>Picture</span>
          <div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 pb-2 [scrollbar-width:none]" data-front-choices>
            <button type="button" onClick={() => (own ? setFront("own") : fileRef.current?.click())} className={`${tile(front === "own")} flex h-[72px] w-[108px] flex-col items-center justify-center gap-1 border border-dashed border-fg/30 bg-mist text-[11.5px] font-semibold`}>
              {own ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={own.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <>
                  <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                    <circle cx="12" cy="13" r="3.5" />
                  </svg>
                  Your photo
                </>
              )}
            </button>
            {photos.map((src) => (
              <button key={src} type="button" onClick={() => setFront(`photo:${src}`)} className={`${tile(front === `photo:${src}`)} h-[72px] w-[108px]`} aria-label="Trip photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
              </button>
            ))}
            {PRINTS.map((p) => (
              <button key={p.id} type="button" onClick={() => setFront(`print:${p.id}`)} className={`${tile(front === `print:${p.id}`)} h-[72px] w-[108px]`} aria-label={`Print: ${p.name}`}>
                <span aria-hidden className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: printSvg(p.id, `t${p.id}`) }} />
              </button>
            ))}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" aria-label="Choose your own photo" onChange={(e) => pickPhoto(e.target.files?.[0])} />
          {own && (
            <button type="button" onClick={() => fileRef.current?.click()} className="mt-1 text-[13px] font-semibold text-fg/70 underline underline-offset-4">
              Change your photo
            </button>
          )}
          {photoState && <p className="mt-1 text-[13px] text-fg/60" role="status">{photoState}</p>}

          <span className={label}>Words on the front</span>
          <div className="flex flex-wrap gap-2">
            {wordOptions.map((w) => (
              <button key={w} type="button" className={chip(!custom && words === w)} onClick={() => (setCustom(false), setWords(w))}>
                {w}
              </button>
            ))}
            <button type="button" className={chip(custom)} onClick={() => setCustom(true)}>
              Your own
            </button>
            <button type="button" className={chip(!custom && words === "")} onClick={() => (setCustom(false), setWords(""))}>
              None
            </button>
          </div>
          {custom && (
            <input value={words} onChange={(e) => setWords(e.target.value.slice(0, 24))} autoFocus placeholder="e.g. the villa that flooded" aria-label="Words on the front" className="mt-3 w-full rounded-2xl border border-line bg-mist px-4 py-3 text-base outline-none focus:border-fg/40" />
          )}

          <span className={label}>Lettering</span>
          <div className="flex flex-wrap gap-2">
            {LETTERINGS.map((l) => (
              <button key={l.id} type="button" className={chip(lettering === l.id)} onClick={() => setLettering(l.id)} style={{ fontFamily: `'${l.family}', serif`, fontStyle: l.italic ? "italic" : undefined, fontSize: l.caps ? 16 : 15, fontWeight: 400 }}>
                {l.name}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setTab("back")} className="pop mt-8 flex h-12 w-full items-center justify-center bg-fg text-[15px] font-semibold text-canvas">
            Next: write on the back
          </button>
        </section>
      )}

      {tab === "back" && (
        <section aria-label="Back">
          <span className={label}>Start with</span>
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none]">
            {OPENERS.map((o) => (
              <button key={o} type="button" className={chip(false)} onClick={() => setMessage((m) => (m.trim() ? `${o.trim()} ${m}` : o))}>
                {o.trim().replace(/ $/, "")}
                {o.endsWith(" ") ? "…" : ""}
              </button>
            ))}
          </div>
          <label className="mt-4 block">
            <span className="sr-only">Your message</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 500))}
              rows={5}
              placeholder="Write something they’ll want to keep…"
              className="w-full resize-none rounded-[20px] border border-line bg-[#f4eee2] px-4 py-3 text-[19px] leading-snug text-[#2b2a5a] outline-none placeholder:text-[#2b2a5a]/40"
              style={{ fontFamily: `'${HANDS.find((h) => h.id === hand)?.family}', cursive` }}
            />
          </label>
          <p className="mt-1 text-right text-xs text-fg/40">{message.length}/500</p>

          <span className={label}>Handwriting</span>
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none]" data-hands>
            {HANDS.map((h) => (
              <button key={h.id} type="button" onClick={() => setHand(h.id)} aria-label={h.family} className={`${chip(hand === h.id)} px-3.5 text-[19px] font-normal`} style={{ fontFamily: `'${h.family}', cursive` }}>
                Hello
              </button>
            ))}
          </div>

          <span className={label}>Stamp</span>
          <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-2 pt-1 [scrollbar-width:none]" data-stamps>
            {stampList.map((s) => (
              <button key={s} type="button" onClick={() => setStamp(s)} className={`shrink-0 rounded-[4px] p-0.5 transition-transform active:scale-95 ${stamp === s ? "outline outline-2 outline-offset-2 outline-fg" : ""}`} aria-label={`Stamp ${s}`} data-stamp-choice={s}>
                <span aria-hidden className="block w-[50px] [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: stampSvg(s, `c${s}`) }} />
              </button>
            ))}
          </div>

          <span className={label}>Paper</span>
          <div className="flex gap-2">
            {PAPERS.map((p) => (
              <button key={p.id} type="button" className={chip(paper === p.id)} onClick={() => setPaper(p.id)}>
                {p.name}
              </button>
            ))}
          </div>

          <span className={label}>Address (write anything)</span>
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <input
                key={i}
                value={address[i]}
                onChange={(e) => {
                  const next = [...address];
                  next[i] = e.target.value.slice(0, 40);
                  setAddr(next);
                }}
                placeholder={["Their name", "the flat that never has milk", "Bengaluru"][i]}
                aria-label={`Address line ${i + 1}`}
                className="w-full rounded-2xl border border-line bg-mist px-4 py-3 text-base outline-none focus:border-fg/40"
              />
            ))}
          </div>
          <button type="button" onClick={() => setTab("send")} disabled={!message.trim()} className="pop mt-8 flex h-12 w-full items-center justify-center bg-fg text-[15px] font-semibold text-canvas disabled:opacity-50">
            {message.trim() ? "Next: who it’s for" : "Write a few words first"}
          </button>
        </section>
      )}

      {tab === "send" && (
        <section aria-label="Send to">
          {!message.trim() && <p className="mt-6 rounded-[18px] bg-mist px-4 py-3 text-sm text-fg/70">Write a few words on the back first.</p>}
          {groups.map((g) => {
            const all = g.people.every((p) => to.includes(p.id));
            return (
              <div key={g.id} className="mt-6">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-fg/55">{g.name}</span>
                  {g.people.length > 1 && (
                    <button type="button" onClick={() => setTo((t) => (all ? t.filter((x) => !g.people.some((p) => p.id === x)) : [...new Set([...t, ...g.people.map((p) => p.id)])]))} className="text-[13px] font-semibold text-fg/80 underline underline-offset-4">
                      {all ? "Clear" : "Everyone"}
                    </button>
                  )}
                </div>
                <ul>
                  {g.people.map((p) => {
                    const on = to.includes(p.id);
                    return (
                      <li key={p.id}>
                        <button type="button" onClick={() => toggle(p.id)} aria-pressed={on} className="flex w-full items-center gap-3 py-2.5 text-left" data-recipient={p.name}>
                          <span aria-hidden className={`flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold ${avatarTone(p.name)}`}>{p.name.charAt(0).toUpperCase()}</span>
                          <span className="flex-1 text-[15px] font-semibold">{p.name}</span>
                          <span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] ${on ? "border-fg bg-fg text-canvas" : "border-fg/30"}`}>
                            {on && (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12.5l4.5 4.5L19 7.5" />
                              </svg>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          <p className="mt-5 text-xs leading-relaxed text-fg/45">Only people who joined Loopin show here. Names typed into a group for someone not on Loopin can’t get postcards.</p>
          <Send count={to.length} ready={Boolean(message.trim())} />
        </section>
      )}
    </form>
  );
}

function Send({ count, ready }: { count: number; ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={!count || !ready || pending} data-haptic="success" className="pop mt-6 flex h-12 w-full items-center justify-center bg-fg text-[15px] font-semibold text-canvas disabled:opacity-50">
      {pending ? "Sending…" : count ? `Send to ${count === 1 ? "1 person" : `${count} people`}` : "Pick who it’s for"}
    </button>
  );
}
