import type { ActivityRowCopy } from "./snapshot-types";
import type { ForMode, SplitType } from "../split";
import type { PaymentMethod } from "../conversion";
import type { DuplicateOf } from "../save-expense";
import type { RefusalCode } from "./words";

// What an expense added offline holds: ONLY what the person typed, plus ids and what the phone had seen. Nothing is worked out on the
// phone (no shares, no totals, no converted amounts); the server does all of that, through saveExpense, when it is added.
export type DraftInput = {
  key: string; // "off-<uuid>": the one-time key, so it can never be saved twice
  groupId: string;
  memberId: string; // who saved it on this phone: only that person may add it, and only that person sees it
  day: string; // the phone's local day, "2026-11-17"
  typedAt: number; // when it was typed (phone clock; shown, never used for money)
  name: string;
  amount: string; // as typed
  currency: string;
  category: string; // "" = guess from the name, as online
  paidById: string;
  multiPay: boolean;
  payers: Record<string, string>;
  forMode: ForMode;
  selected: string[];
  onePersonId: string;
  splitType: SplitType;
  exact: Record<string, string>;
  percent: Record<string, string>;
  shares: Record<string, string>;
  kind: "expense" | "refund";
  paymentMethod: PaymentMethod;
  markupChoice: "group" | "none" | "custom";
  markupCustom: string;
  notes: string;
  rateMode: "auto" | "manual";
  manualRate: string;
  // What the phone saw when it was written: the server refuses the draft if the group is no longer like this.
  seen: { baseCurrency: string; cardMarkupBp: number; activeMemberIds: string[]; snapshotAt: string };
};

export type DraftStatus = "waiting" | "refused" | "duplicate";
export type Draft = DraftInput & {
  status: DraftStatus;
  reason?: string;
  code?: RefusalCode;
  dup?: DuplicateOf;
  keepBoth?: boolean; // the person said "Different, keep both": send it past the duplicate question
};

// The one request: POST /api/offline/add.
export type AddRequest = { draft: DraftInput; dryRun?: boolean; allowDuplicate?: boolean };
export type AddAnswer =
  | { status: "added"; id: string } // saved now, or the key was already used (the same expense, once)
  | { status: "ok" } // dry run: would be added
  | { status: "duplicate"; dup: DuplicateOf }
  | { status: "refused"; code: RefusalCode; reason: string }
  | { status: "later"; reason: string }; // too many requests, busy, not signed in yet: keep it waiting, try again later

export type { ActivityRowCopy };
