"use client";

import { useEffect, useState } from "react";
import Link from "@/components/Link";
import { AddExpenseForm } from "@/components/AddExpenseForm";
import type { ExpenseInitial } from "@/lib/expense-initial";
import { draftsFor } from "@/lib/offline/store";
import { useStore } from "./useOffline";
import type { Draft } from "@/lib/offline/types";

type FormProps = Omit<React.ComponentProps<typeof AddExpenseForm>, "initial" | "fixed" | "offline" | "keepOffline">;

// "Open and fix": the normal Add screen, filled in from an expense kept on this phone that the server refused. It keeps the SAME one-time
// key (a refusal never used it), so it can still only ever be added once. Only the person who saved it can open it.
export function OfflineFix({ draftKey, formProps, back }: { draftKey: string; formProps: FormProps; back: string }) {
  const { kv, works } = useStore();
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
  useEffect(() => {
    if (!kv || works === null) return;
    if (!works) return setDraft(null);
    void draftsFor(kv, formProps.groupId).then((all) => setDraft(all.find((d) => d.key === draftKey && d.memberId === formProps.myId) ?? null), () => setDraft(null));
  }, [kv, works, draftKey, formProps.groupId, formProps.myId]);
  if (draft === undefined) return null;
  if (!draft) {
    return (
      <div className="space-y-4" data-fix-missing>
        <p className="text-sm text-fg/75">That expense isn’t on this phone any more. It may already be added.</p>
        <Link href={back} className="flex min-h-11 items-center font-semibold underline underline-offset-4">
          Back
        </Link>
      </div>
    );
  }
  const initial: ExpenseInitial = {
    name: draft.name,
    amount: draft.amount,
    currency: draft.currency,
    category: draft.category,
    paidById: draft.paidById,
    forMode: draft.forMode,
    selected: draft.selected,
    onePersonId: draft.onePersonId,
    splitType: draft.splitType,
    exact: draft.exact,
    percent: draft.percent,
    shares: draft.shares,
    kind: draft.kind,
    multiPay: draft.multiPay,
    payers: draft.payers,
    paymentMethod: draft.paymentMethod,
    markupChoice: draft.markupChoice,
    markupCustom: draft.markupCustom,
    rate: "",
    rateDate: "",
    date: draft.day,
    notes: draft.notes,
    version: "",
  };
  return (
    <>
      {draft.reason && (
        <p role="status" className="-mt-2 mb-5 rounded-xl bg-mist px-4 py-3 text-sm" data-fix-reason>
          {draft.reason}
        </p>
      )}
      <AddExpenseForm {...formProps} key={draft.key} initial={initial} fixed={{ key: draft.key, manualRate: draft.rateMode === "manual" ? draft.manualRate : undefined }} />
    </>
  );
}
