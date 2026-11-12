// The one-time sheet that explains what is special about a Home group, a Couple or The Pot.
// Pure rules (what it says, and "shown once" remembered per phone), so they can be tested.
// Every sentence below describes something the app really does: see the notes beside each card.

export type SheetKind = "home" | "couple" | "pot";
export type SheetCard = { icon: "repeat" | "door" | "split" | "ahead" | "tally" | "confirm"; title: string; body: string };
export type TypeSheet = { kind: SheetKind; title: string; cards: SheetCard[]; primary: { label: string; href: string } };

export function sheetFor(type: string, groupId: string): TypeSheet | null {
  if (type === "home") {
    return {
      kind: "home",
      title: "Your home group is ready",
      cards: [
        // Bills: fixed ones are added on their day, ones that change ask whoever pays to enter the amount, daily ones (milk) are added up at month end.
        { icon: "repeat", title: "Bills that repeat", body: "Add rent, Wi-Fi or milk once. Fixed bills are added on their day each month, and for ones that change, like electricity, whoever pays gets a nudge to enter the amount." },
        // Move page: their share for the days they stayed, the deposit, the final payments. Someone moving in part-way pays for the days they are there.
        { icon: "door", title: "Moving in or out", body: "Someone who moves in or out mid-month pays only for the days they’re there. Loopin works out the share, the deposit and the final payments." },
      ],
      primary: { label: "Add the first bill", href: `/groups/${groupId}/bills/new` },
    };
  }
  if (type === "couple") {
    return {
      kind: "couple",
      title: "You two are set",
      cards: [
        // NewGroupForm: equal, any ratio such as 60/40, or worked out from incomes; only the split is saved.
        { icon: "split", title: "Your split", body: "Set it once: 50/50, 60/40, or worked out from your incomes. Every expense uses it unless you change that one. Only the split is saved, never your incomes." },
        // ThisMonthTab: "Overall you're X ahead / behind".
        { icon: "ahead", title: "Who’s ahead", body: "This month shows what you spent together and whether you’re ahead or behind your share, with a savings goal if you’re saving for something." },
      ],
      primary: { label: "Add the first expense", href: `/groups/${groupId}/add` },
    };
  }
  if (type === "pot") {
    return {
      kind: "pot",
      title: "Your Pot is ready",
      cards: [
        // Game page: "At the table. This is only a count: nothing is owed until the game is finished."
        { icon: "tally", title: "Game tally vs Money owed", body: "The Game tally is only a count while you play. Nothing is owed until the game is finished, then it shows up under Money owed." },
        // PotCount: finishing asks "Put this game into Money owed?"; the host can reopen it.
        { icon: "confirm", title: "Balances only after you confirm", body: "When a game ends, Loopin asks before its result goes into the group’s balances. You can reopen the game if something was off." },
      ],
      primary: { label: "Start a game", href: `/groups/${groupId}/pot/new` },
    };
  }
  return null;
}

// "Shown once", remembered per phone and per group. Storage can be blocked or full (private
// browsing, strict settings): that must never break the page, so every call is guarded.
type Store = Pick<Storage, "getItem" | "setItem">;
export const sheetKey = (groupId: string) => `lp-type-sheet-${groupId}`;
// A test browser sets this to "1" so the sheet never sits over the screen it is trying to click. People never see it.
export const SHEET_OFF_KEY = "lp-type-sheet-off";

// True only when we could read the store and this group's sheet hasn't been seen. If storage can't be read,
// the sheet stays hidden: better never than on every visit.
export function shouldShowSheet(store: Store | null | undefined, groupId: string): boolean {
  try {
    if (!store) return false;
    if (store.getItem(SHEET_OFF_KEY) === "1") return false;
    return store.getItem(sheetKey(groupId)) === null;
  } catch {
    return false;
  }
}

export function markSheetSeen(store: Store | null | undefined, groupId: string): void {
  try {
    store?.setItem(sheetKey(groupId), "1");
  } catch {
    /* can't remember: the sheet is closed for this visit anyway */
  }
}
