"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { PostcardBack, PostcardFront, type BackProps, type FrontProps } from "@/components/postcards/Card";
import { PostcardOneSide, type OneSideProps } from "@/components/postcards/OneSide";
import { PostcardShare } from "@/components/postcards/PostcardView";
import { avatarTone } from "@/components/ui";
import { DateField } from "@/components/DateField";
import type { PostcardGroup } from "@/lib/postcards/people";
import { chip } from "./shared";

// The last step: a look at the card, who it's for, when they can open it, then send. This one is an ordinary page (it can be longer than
// the screen), unlike the edit steps.
export function SendStep({ groups, to, setTo, opensOn, setOpensOn, hasMessage, onWrite, front, back, one }: {
  groups: PostcardGroup[];
  to: string[];
  setTo: (f: (t: string[]) => string[]) => void;
  opensOn: string;
  setOpensOn: (v: string) => void;
  hasMessage: boolean;
  onWrite: () => void;
  front: FrontProps;
  back: BackProps;
  one: OneSideProps | null;
}) {
  const toggle = (id: string) => setTo((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  return (
    <section aria-label="Send to" className="mt-6">
      {one ? (
        <PostcardOneSide {...one} k="sendone" />
      ) : (
        <div className="grid grid-cols-2 gap-2.5" data-send-preview>
          <PostcardFront {...front} k="sendf" />
          <PostcardBack {...back} k="sendb" />
        </div>
      )}
      {!hasMessage && (
        <button type="button" onClick={onWrite} className="mt-5 flex min-h-11 w-full items-center justify-between rounded-[14px] border border-line bg-mist px-4 py-3 text-left text-sm text-fg/80 active:opacity-80" data-write-first>
          <span>Write a few words {one ? "on the card" : "on the back"} first</span>
          <span aria-hidden>›</span>
        </button>
      )}
      <h2 className="mb-1 mt-7 font-display text-[21px] font-semibold">Who it’s for</h2>
      <p className="text-[13px] text-fg/70">People from your groups who are on Loopin</p>
      {groups.length === 0 && <p className="mt-2 text-sm leading-relaxed text-fg/70">In Loopin, postcards go to friends you share a group with. Invite someone to a group and they’ll show here.</p>}
      {groups.map((g) => {
        const all = g.people.every((p) => to.includes(p.id));
        return (
          <div key={g.id} className="mt-5">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-fg/65">{g.name}</span>
              {g.people.length > 1 && (
                <button type="button" onClick={() => setTo((t) => (all ? t.filter((x) => !g.people.some((p) => p.id === x)) : [...new Set([...t, ...g.people.map((p) => p.id)])]))} className="min-h-11 px-1 text-[13px] font-semibold text-fg/85 underline underline-offset-4">
                  {all ? "Clear" : "Everyone"}
                </button>
              )}
            </div>
            <ul>
              {g.people.map((p) => {
                const on = to.includes(p.id);
                return (
                  <li key={p.id} className="border-b border-line">
                    <button type="button" onClick={() => toggle(p.id)} aria-pressed={on} className="flex min-h-14 w-full items-center gap-3 text-left" data-recipient={p.name}>
                      <span aria-hidden className={`flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold ${avatarTone(p.name)}`}>{p.name.charAt(0).toUpperCase()}</span>
                      <span className="flex-1 text-[15px] font-semibold">{p.name}</span>
                      <span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] ${on ? "border-fg text-fg" : "border-fg/30"}`}>
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
      {groups.length > 0 && <OpensOn value={opensOn} onChange={setOpensOn} />}
      <p className="mt-5 text-xs leading-relaxed text-fg/65">Only people who joined Loopin show here. Names typed into a group for someone not on Loopin can’t get postcards.</p>
      {groups.length > 0 && <Send count={to.length} ready={hasMessage} />}
      {hasMessage && (
        <>
          <p className="my-3 text-center text-[13px] text-fg/65">or</p>
          <div className="rounded-[20px] border border-line bg-[#16161a] px-4 py-4" data-whatsapp-anyone>
            <p className="mb-3 text-[15px] font-semibold">Send to anyone on WhatsApp</p>
            <PostcardShare front={front} back={back} one={one} name="postcard" />
            <p className="mt-2 text-center text-[12.5px] text-fg/65">For anyone, even if they’re not on Loopin</p>
          </div>
        </>
      )}
    </section>
  );
}

// Open now, or sealed until a day you pick: they see an envelope and the date until then.
function OpensOn({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const quick = [
    { name: "New Year’s Day", d: new Date(now.getFullYear() + 1, 0, 1) },
    { name: "In a month", d: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()) },
    { name: "A year from today", d: new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()) },
  ];
  const [picking, setPicking] = useState(false);
  const nice = value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : "";
  return (
    <div data-opens>
      <h2 className="mb-3 mt-7 text-[14px] font-semibold text-fg/70">When they can open it</h2>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={chip(!value && !picking)} aria-pressed={!value && !picking} onClick={() => (setPicking(false), onChange(""))}>
          Right away
        </button>
        {quick.map((q) => (
          <button key={q.name} type="button" className={chip(value === iso(q.d))} aria-pressed={value === iso(q.d)} onClick={() => (setPicking(false), onChange(iso(q.d)))}>
            {q.name}
          </button>
        ))}
        <button type="button" className={chip(picking)} aria-pressed={picking} onClick={() => setPicking(true)}>
          Pick a day
        </button>
      </div>
      {picking && <DateField min={iso(tomorrow)} max={iso(new Date(now.getFullYear() + 2, now.getMonth(), now.getDate()))} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Day it opens" className="mt-3" />}
      {value && (
        <p className="mt-3 flex items-center gap-2 rounded-[16px] border border-line bg-[#16161a] px-4 py-3 text-[13.5px] text-fg/85" data-sealed-note>
          <span aria-hidden className="h-3 w-3 shrink-0 rounded-full border-[1.5px] border-fg" />
          Sealed until {nice}. They’ll know it’s coming, but can’t read it till then.
        </p>
      )}
    </div>
  );
}

function Send({ count, ready }: { count: number; ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={!count || !ready || pending} data-haptic="success" className="pop mt-6 flex h-14 w-full items-center justify-center bg-fg text-[17px] font-semibold text-canvas disabled:opacity-50">
      {pending ? "Sending…" : count ? `Send to ${count === 1 ? "1 person" : `${count} people`}` : "Pick who it’s for"}
    </button>
  );
}
