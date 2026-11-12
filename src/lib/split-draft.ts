// What the add-expense form sends as "who it's for and how it's split". Item mode (each bill line goes to the people who
// had it) overrides the equal/some/custom choices, so it must only apply while item mode is really on. Pure.
export function splitFields<F extends string, S extends string>(p: {
  byItem: boolean;
  forMode: F;
  splitType: S;
  exact: Record<string, string>;
  itemExact: Record<string, string>;
}): { forMode: F | "everyone"; splitType: S | "exact"; exact: Record<string, string> } {
  return p.byItem
    ? { forMode: "everyone", splitType: "exact", exact: p.itemExact }
    : { forMode: p.forMode, splitType: p.splitType, exact: p.exact };
}

// Which split is in effect after the user taps something. Item mode is its own choice: every other choice leaves it
// (otherwise the item amounts would still be sent while "Everyone equally" shows as selected). Pure.
import type { ForMode, SplitType } from "./split";
export type SplitChoice = { byItem: boolean; forMode: ForMode; splitType: SplitType };
export type SplitAction =
  | { kind: "everyone-equally" }
  | { kind: "only-some" }
  | { kind: "group-split" }
  | { kind: "how"; id: SplitType | "items" };
export function chooseSplit(s: SplitChoice, a: SplitAction): SplitChoice {
  switch (a.kind) {
    case "everyone-equally":
      return { byItem: false, forMode: "everyone", splitType: "equal" };
    case "only-some":
      return { byItem: false, forMode: "selected", splitType: "equal" };
    case "group-split":
      return { byItem: false, forMode: "everyone", splitType: "shares" };
    case "how":
      return a.id === "items" ? { ...s, byItem: true } : { ...s, byItem: false, splitType: a.id };
  }
}
