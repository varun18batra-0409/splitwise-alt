"use client";

import { useState } from "react";
import { parseQuickLine, type QuickResult } from "@/lib/quickline";

// "Type it in one line": the form below fills itself in; you check and save.
export function QuickLine({
  members,
  myId,
  who,
  currency,
  onFill,
}: {
  members: { id: string; name: string }[];
  myId: string;
  who: (id: string) => string;
  currency: string;
  onFill: (q: QuickResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [done, setDone] = useState<QuickResult | null>(null);
  const example = `Dinner 2400 ${members.find((m) => m.id !== myId)?.name.split(" ")[0] ?? "Ravi"} paid split with everyone`;

  function fill() {
    if (!text.trim()) return;
    const q = parseQuickLine(text, members, myId);
    onFill(q);
    setDone(q);
  }

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="-mt-3 flex items-center gap-1.5 py-1 text-sm font-medium text-fg">
        <span aria-hidden>⚡</span> Type it in one line
      </button>
    );
  return (
    <div className="-mt-3 rounded-2xl border border-line p-3" role="group" aria-label="Quick line">
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
        <button type="button" onClick={fill} className="shrink-0 rounded-xl bg-fg px-4 text-sm font-semibold text-canvas">
          Fill
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-500" role="status">
        {done
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
