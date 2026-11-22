"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MoneyCard } from "@/components/MoneyCard";
import { AddExpenseForm } from "@/components/AddExpenseForm";
import { BackIcon, PlusIcon, iconButtonClass } from "@/components/icons";
import { ExpenseGlyph } from "@/components/ExpenseGlyph";
import { guessCategory, isCategory } from "@/lib/categories";
import { dayWords, timeText } from "@/lib/offline/describe";
import { todayKey } from "@/lib/dates";
import { draftsFor, removeDraft, visibleSnapshots } from "@/lib/offline/store";
import { W } from "@/lib/offline/words";
import type { Snapshot } from "@/lib/offline/snapshot-types";
import type { Draft } from "@/lib/offline/types";
import { OUTLINE } from "./classes";
import { DraftRow, WaitingCard } from "./DraftRows";
import { useGroupData, useStore } from "./useOffline";
import { useSignal } from "./useSignal";

// The one generic offline screen (/offline-app). The service worker keeps it on the phone and sends group pages and Home here when
// there is no signal. It loads nothing from the server and holds nothing personal itself: it draws the group's offline page, the
// offline Add screen and a small offline Home from what this phone kept (see src/lib/offline/store.ts).
//   /offline-app            offline Home
//   /offline-app?g=ID       the group, offline
//   /offline-app?g=ID&s=add the Add screen, offline
// The moment there is a signal it goes back to the real page by itself.
const link = "flex min-h-11 items-center";

export function OfflineApp() {
  const [where, setWhere] = useState<{ g: string | null; s: string | null } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setWhere({ g: q.get("g"), s: q.get("s") });
  }, []);
  const { signal, check, checking } = useSignal(4000);
  // Something has been typed or tapped on the offline Add screen. Going to the real page then would throw it away, so it waits for a tap.
  // (A ref, not state: typing must not re-draw this screen.)
  const touched = useRef(false);
  const [holdBack, setHoldBack] = useState(false);

  // A real page can load again: go to it (the group, its Add page, or Home). The "You're back online" sheet opens there.
  useEffect(() => {
    if (signal !== "online" || !where || holdBack) return;
    if (where.s === "add" && touched.current) return setHoldBack(true);
    const real = where.g ? (where.s === "add" ? `/groups/${where.g}/add` : `/groups/${where.g}`) : "/";
    window.location.replace(real);
  }, [signal, where, holdBack]);

  const status = (
    <span role="status" className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] text-fg/80" data-offline-net={signal}>
      <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-owe" />
      {signal === "online" ? "Back online" : signal === "checking" ? "Checking…" : W.offlineTag}
    </span>
  );
  const tryAgain = (
    <button type="button" onClick={() => void check()} disabled={checking} className={`${OUTLINE} mt-6 w-full`} data-offline-try-again>
      {checking ? "Checking…" : W.tryAgain}
    </button>
  );

  return (
    <section
      data-offline-app
      className="pb-8"
      onInputCapture={() => void (touched.current = true)}
      onChangeCapture={() => void (touched.current = true)}
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest("form")) touched.current = true;
      }}
    >
      {holdBack && where?.g && (
        <div role="status" className="mb-4 rounded-[20px] border border-line px-4 py-3 text-sm" data-offline-back-online>
          <p className="text-fg/80">{W.backOnlineHold}</p>
          <a href={`/groups/${where.g}`} className="mt-2 flex min-h-11 items-center font-semibold underline underline-offset-4">
            {W.openGroup}
          </a>
        </div>
      )}
      {!where ? null : where.g ? <GroupScreen groupId={where.g} add={where.s === "add"} status={status} tryAgain={tryAgain} /> : <HomeScreen status={status} tryAgain={tryAgain} />}
    </section>
  );
}

// ---- Home ----
function HomeScreen({ status, tryAgain }: { status: React.ReactNode; tryAgain: React.ReactNode }) {
  const { kv, works } = useStore();
  const [groups, setGroups] = useState<{ snap: Snapshot; waiting: number }[] | null>(null);
  useEffect(() => {
    if (!kv || !works) return;
    void (async () => {
      const snaps = await visibleSnapshots(kv);
      const all = await draftsFor(kv);
      setGroups(snaps.map((snap) => ({ snap, waiting: all.filter((d) => d.groupId === snap.groupId).length })));
    })().catch(() => setGroups([]));
  }, [kv, works]);
  const total = (groups ?? []).reduce((n, g) => n + g.waiting, 0);
  return (
    <>
      <div className="flex items-center justify-between">{status}</div>
      <h1 className="mt-4 font-display text-[28px] font-semibold leading-tight tracking-[-0.02em]">{W.youreOffline}</h1>
      {works === false && <p className="mt-3 text-sm text-fg/70">{W.noPrivate}</p>}
      {total > 0 && <p className="mt-2 text-sm text-fg/70" data-offline-home-count>{W.waitingTitle(total)}</p>}
      {groups && groups.length === 0 && works && (
        <p className="mt-3 text-sm text-fg/70">Open a group once while you’re online, and you can add expenses to it here when you’re not.</p>
      )}
      {groups && groups.length > 0 && (
        <>
          <p className="mt-5 text-[13px] font-semibold text-fg/55">Add to</p>
          <ul className="mt-1 divide-y divide-line" data-offline-groups>
            {groups.map(({ snap, waiting }) => (
              <li key={snap.groupId} className="flex items-center gap-3 py-2.5">
                <a href={`/groups/${snap.groupId}`} className={`${link} min-w-0 flex-1 flex-col items-start justify-center`}>
                  <span className="max-w-full truncate text-[16px] font-semibold">{snap.name}</span>
                  <span className="text-[13px] text-fg/60">
                    {snap.peopleCount} people{waiting ? ` · ${W.waitingTitle(waiting)}` : ""}
                  </span>
                </a>
                <a href={`/groups/${snap.groupId}/add`} aria-label={`Add expense to ${snap.name}`} className={`${OUTLINE} shrink-0 gap-1.5`} data-offline-add-to>
                  <PlusIcon size={16} />
                  Add
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      {tryAgain}
    </>
  );
}

// ---- A group, and its Add screen ----
function GroupScreen({ groupId, add, status, tryAgain }: { groupId: string; add: boolean; status: React.ReactNode; tryAgain: React.ReactNode }) {
  const { kv, works, drafts, snapshot, loaded, reload } = useGroupData(groupId);
  if (!loaded) return null;
  if (!snapshot || !kv) {
    return (
      <>
        <div className="flex items-center justify-between">
          <a href="/" aria-label="Back" className={iconButtonClass}>
            <BackIcon size={20} />
          </a>
          {status}
        </div>
        <h1 className="mt-4 font-display text-[28px] font-semibold leading-tight tracking-[-0.02em]">{W.youreOffline}</h1>
        <p className="mt-3 text-sm text-fg/70">{works === false ? W.noPrivate : "This group isn’t kept on this phone yet. Open it once while you’re online, and you can add to it here when you’re not."}</p>
        {tryAgain}
      </>
    );
  }
  return add ? <AddScreen snapshot={snapshot} status={status} /> : <GroupView snapshot={snapshot} drafts={drafts} status={status} tryAgain={tryAgain} remove={async (key) => { await removeDraft(kv, key); await reload(); }} />;
}

const namesOf = (s: Snapshot) => (id: string) => (id === s.memberId ? "You" : (s.members.find((m) => m.id === id)?.name ?? "Someone"));

function GroupView({ snapshot: s, drafts, status, tryAgain, remove }: { snapshot: Snapshot; drafts: Draft[]; status: React.ReactNode; tryAgain: React.ReactNode; remove: (key: string) => Promise<void> }) {
  const nameOf = useMemo(() => namesOf(s), [s]);
  const asOf = timeText(Date.parse(s.savedAt), s.tz);
  return (
    <>
      <div className="flex items-center justify-between">
        <a href="/" aria-label="Back" className={iconButtonClass}>
          <BackIcon size={20} />
        </a>
        {status}
      </div>
      <h1 className="mt-1 font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.02em]">{s.name}</h1>
      <p className="mb-4 mt-2 text-sm text-fg/70">
        {s.peopleCount} people{s.dayLine ? ` · ${s.dayLine}` : ""}
      </p>
      <MoneyCard
        label={s.balance.label}
        text={s.balance.text}
        tone={s.balance.tone}
        square={s.balance.paise === 0}
        eq={s.balance.eq || null}
        action={
          s.balance.canSettle ? (
            <span className="flex h-11 shrink-0 items-center rounded-full bg-fg/[0.12] px-5 text-[15px] font-semibold text-fg/60" aria-disabled="true" data-settle-disabled>
              {W.settleOffline}
            </span>
          ) : null
        }
        line={s.balance.summary ? <p className="mt-1 text-[13px] leading-snug text-fg/55">{s.balance.summary}</p> : null}
        note={
          <p className="mt-2 text-[13px] text-fg/60" data-as-of>
            {W.asOf(asOf)}
          </p>
        }
      />
      <WaitingCard count={drafts.length} />
      <a href={`/groups/${s.groupId}/add`} className={`${OUTLINE} -mt-1 mb-5 w-full gap-2`} data-add-expense>
        <PlusIcon size={18} />
        Add expense
      </a>
      {(drafts.length > 0 || s.rows.length > 0) && (
        <section aria-labelledby="recent-h" className="mb-4" data-recent-expenses>
          <h2 id="recent-h" className="font-display text-[20px] font-semibold tracking-tight">
            Recent expenses
          </h2>
          <ul className="divide-y divide-line">
            {drafts.map((d) => (
              <DraftRow key={d.key} draft={d} nameOf={nameOf} canFix={false} onRemove={(k) => void remove(k)} />
            ))}
            {s.rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3.5 py-3.5" data-saved-row>
                <ExpenseGlyph title={r.title} category={isCategory(r.category) ? r.category : guessCategory(r.title)} label="" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 break-words text-[15px] font-semibold leading-snug tracking-tight">{r.title}</p>
                  <p className="mt-0.5 break-words text-[13px] leading-snug text-fg/60">{r.line}</p>
                  <p className="mt-0.5 truncate text-[13px] leading-snug text-fg/60">{dayWords(r.day, todayKey(new Date(), s.tz))}</p>
                </div>
                <span className="shrink-0 whitespace-nowrap text-right leading-tight">
                  {r.effectAmount && <span className={`block text-[15px] font-semibold tabular-nums ${r.tone === "owed" ? "text-owed" : r.tone === "owe" ? "text-owe" : ""}`}>{r.effectAmount}</span>}
                  <span className="mt-0.5 block text-[11px] text-fg/60">{r.effectLabel}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {tryAgain}
    </>
  );
}

function AddScreen({ snapshot: s, status }: { snapshot: Snapshot; status: React.ReactNode }) {
  const onSaved = useCallback(() => window.location.assign(`/groups/${s.groupId}`), [s.groupId]);
  return (
    <>
      <div className="flex items-center gap-3">
        <a href={`/groups/${s.groupId}`} aria-label="Close" className={iconButtonClass}>
          <BackIcon size={20} />
        </a>
        <h1 className="min-w-0 flex-1 truncate font-display text-[22px] font-semibold tracking-[-0.01em]">Add to {s.name}</h1>
        {status}
      </div>
      <p role="status" className="mb-6 mt-4 flex items-start gap-2.5 rounded-[14px] border border-line px-4 py-3 text-sm text-fg/85" data-offline-note>
        <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffab6b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mt-px shrink-0">
          <path d="M2 8.5a15 15 0 0 1 4.5-2.8M10 4.6A15 15 0 0 1 22 8.5M5 12a10 10 0 0 1 3-1.8M13.5 10.4A10 10 0 0 1 19 12M8.5 15.5a5 5 0 0 1 5.5-.6" />
          <circle cx="12" cy="19" r="1" />
          <path d="M3 3l18 18" />
        </svg>
        <span>{W.offlineHeader}</span>
      </p>
      <AddExpenseForm
        groupId={s.groupId}
        baseCurrency={s.currency}
        groupMarkupBp={s.cardMarkupBp}
        members={s.members.map(({ id, name }) => ({ id, name }))}
        myId={s.memberId}
        tz={s.tz}
        weights={Object.fromEntries(s.members.map((m) => [m.id, m.splitWeight]))}
        splitName={s.splitName}
        spin={s.type !== "pot"}
        offline={{ groupName: s.name, snapshotAt: s.savedAt, onSaved }}
      />
    </>
  );
}
