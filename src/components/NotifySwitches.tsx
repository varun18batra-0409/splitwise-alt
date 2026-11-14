"use client";

import { useRef, useState } from "react";
import { CATEGORIES, type Channel } from "@/lib/account-notify";
import { setNotifyPref } from "@/app/notify-pref-actions";

// "Notifications & email": a card per kind of notification with an Allow switch for the whole card and a switch per item,
// then the emails Loopin really sends. Every switch is saved the moment it is tapped (with a small "Saved").
// Only what is OFF is stored, so `off` lists the switched-off keys per channel.

type Off = Record<Channel, Record<string, boolean>>;

function Track({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={`relative h-7 w-12 shrink-0 rounded-full transition-colors motion-reduce:transition-none ${on ? "bg-fg" : "bg-fg/15"}`}>
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-canvas transition-all motion-reduce:transition-none ${on ? "left-6" : "left-1"}`} />
    </span>
  );
}

function Row({ label, on, dim, strong, onTap, name }: { label: string; on: boolean; dim?: boolean; strong?: boolean; onTap: () => void; name: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={dim}
      onClick={onTap}
      data-switch={name}
      className={`flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left active:bg-fg/[0.05] disabled:active:bg-transparent ${dim ? "opacity-45" : ""}`}
    >
      <span className={`min-w-0 flex-1 ${strong ? "font-display text-[17px] font-semibold" : "text-[15px]"}`}>{label}</span>
      <Track on={on} />
    </button>
  );
}

export function NotifySwitches({ initial }: { initial: Off }) {
  const [off, setOff] = useState<Off>(initial);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const busy = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function flip(channel: Channel, key: string, card: string) {
    const id = `${channel}:${key}`;
    if (busy.current.has(id)) return; // a double tap while saving does nothing
    busy.current.add(id);
    const wasOff = Boolean(off[channel][key]);
    const set = (isOff: boolean) => setOff((o) => ({ ...o, [channel]: { ...o[channel], [key]: isOff } }));
    set(!wasOff);
    setError("");
    try {
      const r = await setNotifyPref(channel, key, wasOff); // turning on when it was off
      if (!r.ok) throw new Error(r.error);
      setSaved(card);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(""), 1800);
    } catch (e) {
      set(wasOff);
      setError(e instanceof Error && e.message ? e.message : "Couldn’t save that. Check your connection and try again.");
    } finally {
      busy.current.delete(id);
    }
  }

  const Saved = ({ card }: { card: string }) => (
    <span role="status" aria-live="polite" className="text-xs font-semibold text-owed">
      {saved === card ? "Saved" : ""}
    </span>
  );
  const emailItems = CATEGORIES.flatMap((c) => c.email);

  return (
    <>
      {error && (
        <p role="alert" className="mb-4 rounded-[20px] border border-line bg-white px-4 py-3 text-sm text-owe">
          {error}
        </p>
      )}
      <section aria-label="On this phone" className="mb-8">
        <h2 className="mb-2.5 px-1 font-display text-lg font-semibold tracking-tight">On this phone</h2>
        <div className="space-y-3">
          {CATEGORIES.map((c) => {
            const catOn = !off.push[c.id];
            return (
              <div key={c.id} className="overflow-hidden rounded-2xl border border-line bg-[#16161a]" data-notify-card={c.id}>
                <div className="flex items-center justify-between gap-3 px-4 pt-3">
                  <p className="text-xs text-fg/55">{c.hint}</p>
                  <Saved card={c.id} />
                </div>
                <Row label={`Allow ${c.label.toLowerCase()}`} on={catOn} strong onTap={() => flip("push", c.id, c.id)} name={`push:${c.id}`} />
                <ul className="divide-y divide-line border-t border-line">
                  {c.push.map((i) => (
                    <li key={i.id}>
                      <Row label={i.label} on={!off.push[i.id]} dim={!catOn} onTap={() => flip("push", i.id, c.id)} name={`push:${i.id}`} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-label="Email" className="mb-3">
        <h2 className="mb-2.5 px-1 font-display text-lg font-semibold tracking-tight">Email</h2>
        <div className="overflow-hidden rounded-2xl border border-line bg-[#16161a]" data-notify-card="email">
          <div className="flex items-center justify-between gap-3 px-4 pt-3">
            <p className="text-xs text-fg/55">The emails Loopin can send you.</p>
            <Saved card="email" />
          </div>
          <ul className="divide-y divide-line">
            {emailItems.map((i) => (
              <li key={i.id}>
                <Row label={i.label} on={!off.email[i.id]} onTap={() => flip("email", i.id, "email")} name={`email:${i.id}`} />
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-3 px-1 text-sm text-fg/60">Sign-in codes and security emails are always sent.</p>
        <p className="mt-1 px-1 text-sm text-fg/60">Each group can also be muted in its settings.</p>
      </section>
    </>
  );
}
