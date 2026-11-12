"use client";

import { useEffect, useRef, useState } from "react";
import { parseQuickLine, type QuickResult } from "@/lib/quickline";
import { readLineAction } from "@/app/ai-actions";
import { useAiConsent } from "./AiConsent";

type Recognition = { lang: string; interimResults: boolean; maxAlternatives: number; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };
type SpeechWindow = { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const speechApi = () => (typeof window === "undefined" ? null : ((window as unknown as SpeechWindow).SpeechRecognition ?? (window as unknown as SpeechWindow).webkitSpeechRecognition ?? null));

// "Type it in one line" (or say it): the form below fills itself in; you
// check and save. The phone reads the line first; when it misses the amount
// or the names and bill reading is on, Claude reads it.
export function QuickLine({
  groupId,
  ai = false,
  members,
  myId,
  who,
  currency,
  onFill,
  openRef,
}: {
  openRef?: { current: ((speak: boolean) => void) | null }; // the form's "Speak" / "Type a line" buttons call this from their own tap
  groupId: string;
  ai?: boolean;
  members: { id: string; name: string }[];
  myId: string;
  who: (id: string) => string;
  currency: string;
  onFill: (q: QuickResult, extra?: { currency?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [done, setDone] = useState<QuickResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState("");
  const [canSpeak, setCanSpeak] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const consent = useAiConsent();
  useEffect(() => setCanSpeak(Boolean(speechApi())), []);
  // Opened from the form's Faster entry row: "Type a line" shows the box, "Speak" also starts listening. The form calls this
  // straight from the tap (phones only allow the microphone to start from a tap, like the camera for Scan a bill).
  function openFromForm(speak: boolean) {
    setOpen(true);
    if (!speak) return;
    if (speechApi()) listen();
    else setNote("This browser can’t listen. Type the line instead.");
  }
  useEffect(() => {
    if (!openRef) return;
    openRef.current = openFromForm;
    return () => {
      openRef.current = null;
    };
  });
  const example = `Dinner 2400 ${members.find((m) => m.id !== myId)?.name.split(" ")[0] ?? "Ravi"} paid split with everyone`;

  async function fill(line = text) {
    if (!line.trim()) return;
    setNote("");
    const q = parseQuickLine(line, members, myId);
    const missed = !q.amount || (!q.paidById && !q.forIds);
    if (missed && ai) {
      setBusy(true);
      try {
        let r = await readLineAction(groupId, line);
        // First time: ask before anything is sent. "Not now" (or an answer of no) keeps the line as the phone read it.
        if (!r.ok && r.needsConsent) {
          setBusy(false);
          if (await consent.ask("line")) {
            setBusy(true);
            r = await readLineAction(groupId, line);
          } else r = { ok: false, error: "", consent: "no" };
        }
        if (r.ok) {
          const merged: QuickResult = { name: r.name || q.name, amount: r.amount || q.amount, paidById: r.paidById || q.paidById, forIds: r.forIds ?? q.forIds, understood: q.understood };
          onFill(merged, { currency: r.currency || undefined });
          setDone(merged);
          return;
        }
        if (r.consent !== "no") setNote(r.error);
      } catch {
        // offline or a hiccup: what the phone read is still used
      } finally {
        setBusy(false);
      }
    }
    onFill(q);
    setDone(q);
  }

  function listen() {
    const Api = speechApi();
    if (!Api) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Api();
    r.lang = navigator.language || "en-IN";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      const said = Array.from(e.results).map((x) => x[0]?.transcript ?? "").join(" ").trim();
      if (said) {
        setText(said);
        void fill(said);
      }
    };
    r.onerror = (e) => setNote(e.error === "not-allowed" ? "Allow the microphone for Loopin to say it." : "Didn’t catch that. Try again, or type it.");
    r.onend = () => setListening(false);
    rec.current = r;
    setNote("");
    setDone(null);
    setListening(true);
    r.start();
  }

  if (!open) return null;
  return (
    <div className="rounded-2xl border border-line p-3" role="group" aria-label="Quick line">
      {consent.sheet}
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDone(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              fill();
            }
          }}
          placeholder={example}
          aria-label="Type the expense in one line"
          autoComplete="off"
          maxLength={200}
          className="min-w-0 flex-1 rounded-xl border border-line bg-mist px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        {canSpeak && (
          <button
            type="button"
            onClick={listen}
            aria-label={listening ? "Stop listening" : "Say it"}
            aria-pressed={listening}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${listening ? "animate-pulse border-owed bg-owed/15 text-owed" : "border-line text-fg/80 active:bg-mist"}`}
          >
            <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
        )}
        <button type="button" onClick={() => void fill()} disabled={busy} className="shrink-0 rounded-xl bg-fg px-4 text-sm font-semibold text-canvas disabled:opacity-60">
          {busy ? "…" : "Fill"}
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-500" role="status">
        {listening
          ? "Listening… say it like “Dinner 2400, Ravi paid, everyone”."
          : busy
            ? "Reading it…"
            : note
              ? note
              : done
          ? done.amount || done.paidById || done.forIds
            ? `Filled in: ${[
                done.name,
                done.amount && `${currency} ${done.amount}`,
                done.paidById && `${who(done.paidById)} paid`,
                done.forIds && (done.forIds.length === members.length ? "everyone" : `for ${done.forIds.map(who).join(", ")}`),
              ]
                .filter(Boolean)
                .join(" · ")}. Check below, then save.`
            : "Couldn’t pick out an amount or names. Try: “Cab 600 except Dev”."
          : "Amount, who paid, and “with / for / except” names. Nothing saves until you tap Save."}
      </p>
    </div>
  );
}
