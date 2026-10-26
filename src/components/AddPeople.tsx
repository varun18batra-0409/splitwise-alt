"use client";

import { useEffect, useRef, useState } from "react";
import { addPerson, invitePeople } from "@/app/actions";
import { InviteIcon, SearchIcon } from "./icons";
import { reportSpeed } from "./speedReport";
import { whatsappLink } from "@/lib/whatsapp";

type Found = { accountId: string; name: string; email: string; inGroup: boolean; known: boolean };
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s.trim());

// 1. Search people already on Loopin (friends you share a group with by name,
//    anyone by exact email) and add them with one tap.
export function PeopleSearch({ groupId }: { groupId: string }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cache = useRef(new Map<string, Found[]>());

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) {
      setFound([]);
      setBusy(false);
      return;
    }
    // Seen this search already: show it straight away.
    const hit = cache.current.get(term.toLowerCase());
    if (hit) {
      setFound(hit);
      setBusy(false);
      return;
    }
    setBusy(true);
    const ctl = new AbortController();
    timer.current = setTimeout(async () => {
      const t0 = performance.now();
      try {
        const r = await fetch(`/api/people?g=${encodeURIComponent(groupId)}&q=${encodeURIComponent(term)}`, { signal: ctl.signal, cache: "no-store" });
        const list: Found[] = r.ok ? await r.json() : [];
        cache.current.set(term.toLowerCase(), list);
        setFound(list);
        setBusy(false);
        reportSpeed("search", location.pathname, performance.now() - t0);
      } catch {
        // Cancelled because another letter was typed: the newer search takes over.
        if (!ctl.signal.aborted) {
          setFound([]);
          setBusy(false);
        }
      }
    }, 200);
    return () => ctl.abort();
  }, [q, groupId]);

  const showInvite = isEmail(q) && !busy && !found.some((f) => f.email === q.trim().toLowerCase());

  return (
    <div>
      <label className="relative block">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
          <SearchIcon size={18} />
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          type="search"
          inputMode="email"
          autoComplete="off"
          placeholder="Name or email"
          aria-label="Search people on Loopin"
          className="w-full rounded-xl border border-line bg-mist py-3 pl-11 pr-4 text-base text-fg outline-none placeholder:text-gray-400 focus:border-accent"
        />
      </label>
      {q.trim().length < 2 && (
        <p className="mt-2 text-xs leading-relaxed text-gray-500">
          People you share a group with show up by name. Anyone else on Loopin: type their <strong className="font-semibold text-fg">full email</strong>. For privacy, nobody can browse Loopin’s members.
        </p>
      )}
      {q.trim().length >= 2 && (
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
          {found.map((f) => (
            <li key={f.accountId} className="flex items-center gap-3 px-3 py-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-mist font-display text-sm font-semibold">
                {f.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {f.name} <span className="ml-1 rounded-full bg-owed/15 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-owed">On Loopin ✓</span>
                </span>
                <span className="block truncate text-xs text-gray-400">{f.email}</span>
              </span>
              {f.inGroup ? (
                <span className="shrink-0 text-xs text-gray-400">In group</span>
              ) : (
                <form action={addPerson} onSubmit={() => cache.current.clear()}>
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="accountId" value={f.accountId} />
                  <button type="submit" className="pop shrink-0 bg-fg px-3 py-1.5 text-sm font-semibold text-canvas [--pop-edge:#6e6b63]">
                    Add
                  </button>
                </form>
              )}
            </li>
          ))}
          {busy && found.length === 0 && <li className="px-3 py-3 text-sm text-gray-400">Searching…</li>}
          {!busy && found.length === 0 && !showInvite && (
            <li className="px-3 py-3 text-sm text-gray-500">
              Not someone you share a group with. To find anyone else on Loopin, type their full email (like name@gmail.com), or send your invite link below.
            </li>
          )}
          {showInvite && (
            <li className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1 text-sm">
                <span className="block truncate">{q.trim()}</span>
                <span className="block text-xs text-gray-400">Not on Loopin yet</span>
              </span>
              <form action={invitePeople}>
                <input type="hidden" name="groupId" value={groupId} />
                <input type="hidden" name="emails" value={q.trim()} />
                <button type="submit" className="shrink-0 border border-line px-3 py-1.5 text-sm font-medium text-fg active:bg-mist">
                  Send invite
                </button>
              </form>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// 2. Invite from the phone's contacts.
//  - Android (Chrome): pick several contacts, then send each the link by
//    WhatsApp, SMS or email.
//  - iPhone and others: websites can't read contacts, so the phone's share
//    sheet opens (Messages, WhatsApp…) and you pick people there.
type Contact = { name: string; tel: string; email: string };
type PickedContact = { name?: string[]; tel?: string[]; email?: string[] };
type ContactsManager = { select: (props: string[], options?: { multiple?: boolean }) => Promise<PickedContact[]> };
function contactsApi(): ContactsManager | null {
  if (typeof window === "undefined" || !("ContactsManager" in window)) return null;
  const c = (navigator as Navigator & { contacts?: ContactsManager }).contacts;
  return c && typeof c.select === "function" ? c : null;
}

export function ContactInvite({ groupId, groupName, link }: { groupId: string; groupName: string; link: string }) {
  const [picker, setPicker] = useState<boolean | null>(null);
  const [picked, setPicked] = useState<Contact[]>([]);
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState("");
  useEffect(() => setPicker(contactsApi() !== null), []);

  const text = (first: string) => `Hi${first ? ` ${first}` : ""}! Join “${groupName}” on Loopin so we can split expenses: ${link}`;

  async function pick() {
    const api = contactsApi();
    if (!api) return;
    setMsg("");
    try {
      const rows = await api.select(["name", "tel", "email"], { multiple: true });
      setPicked(
        rows
          .map((c) => ({ name: (c.name?.[0] ?? "").trim(), tel: (c.tel?.[0] ?? "").replace(/[^\d+]/g, ""), email: (c.email?.[0] ?? "").trim() }))
          .filter((c) => c.name || c.tel || c.email),
      );
    } catch {
      setMsg("Couldn’t open your contacts. Allow Loopin to use them, or share the link instead.");
    }
  }
  async function share() {
    setMsg("");
    try {
      if (navigator.share) {
        await navigator.share({ title: `Join ${groupName} on Loopin`, text: text(""), url: link });
        return;
      }
      await navigator.clipboard.writeText(text(""));
      setMsg("Invite copied. Paste it in a chat.");
    } catch {
      /* closed the share sheet */
    }
  }

  if (picker === null) return null;
  return (
    <div>
      <button
        type="button"
        onClick={picker ? pick : share}
        className="flex w-full items-center justify-center gap-2 border border-line px-4 py-3 text-[15px] font-medium text-fg active:bg-mist"
      >
        <InviteIcon size={18} /> {picker ? "Choose from contacts" : "Invite from contacts"}
      </button>
      {!picker && <p className="mt-1.5 text-xs text-gray-400">Opens your phone’s share sheet: pick people in Messages or WhatsApp.</p>}
      {msg && <p className="mt-1.5 text-xs text-gray-500">{msg}</p>}
      {picked.some((c) => c.email) && (
        <form action={invitePeople} className="mt-3">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="emails" value={picked.map((c) => c.email).filter(Boolean).join(",")} />
          <button type="submit" className="pop block w-full bg-fg px-4 py-2.5 text-sm font-semibold text-canvas [--pop-edge:#6e6b63]">
            Email the invite to {picked.filter((c) => c.email).length} {picked.filter((c) => c.email).length === 1 ? "person" : "people"}
          </button>
        </form>
      )}
      {picked.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
          {picked.map((c, i) => {
            const key = `${c.name}-${c.tel}-${c.email}-${i}`;
            const first = c.name.split(" ")[0];
            const mark = () => setSent((s) => ({ ...s, [key]: true }));
            return (
              <li key={key} className="px-3 py-2.5">
                <p className="truncate font-medium">
                  {c.name || c.tel || c.email}
                  {sent[key] && <span className="ml-2 text-xs font-normal text-owed">Invite sent ✓</span>}
                </p>
                <p className="truncate text-xs text-gray-400">{[c.tel, c.email].filter(Boolean).join(" · ")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {c.tel && (
                    <a
                      href={whatsappLink(text(first), c.tel.replace(/\D/g, ""))}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={mark}
                      className="border border-line px-3 py-1.5 text-sm text-fg active:bg-mist"
                    >
                      WhatsApp
                    </a>
                  )}
                  {c.tel && (
                    <a href={`sms:${c.tel}?&body=${encodeURIComponent(text(first))}`} onClick={mark} className="border border-line px-3 py-1.5 text-sm text-fg active:bg-mist">
                      SMS
                    </a>
                  )}
                  {c.email && (
                    <form action={invitePeople} onSubmit={mark}>
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="emails" value={c.email} />
                      <button type="submit" className="border border-line px-3 py-1.5 text-sm text-fg active:bg-mist">
                        Email
                      </button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
