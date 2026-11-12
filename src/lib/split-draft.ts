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
