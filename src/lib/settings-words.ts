// Words on the group settings screen that depend on what kind of group it is.
const KEPT = "History is kept and you can reopen it any time.";

export function closeHint(type: string, closed: boolean): string {
  if (closed) return "New expenses are paused. History is kept.";
  switch (type) {
    case "trip":
      return `Trip over? Close it. ${KEPT}`;
    case "home":
      return `Moved on from the flat? Close it. ${KEPT}`;
    case "couple":
      return `Closing pauses new expenses between the two of you. ${KEPT}`;
    case "pot":
      return `Game night over? Close it. ${KEPT}`;
    default:
      return `All done here? Close it. ${KEPT}`;
  }
}

// Under the shares box: true because saving changes the default split for new expenses (and bills added from then on) only.
export function sharesHint(type: string): string {
  return type === "couple"
    ? "Your split for every expense, e.g. 55 and 45. Applies to new expenses; ones already added keep their split."
    : "Everyone pays 1 share unless you change it, e.g. 1.5 for a bigger room. Applies to new expenses; ones already added keep their split.";
}
