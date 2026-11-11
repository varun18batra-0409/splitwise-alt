// What happens when someone leaves, is removed, or a group is deleted, in plain
// words. One place, so the screens and the tests read the same thing.

export type StaysGoes = { stays: string[]; goes: string[]; goesTitle: string; extra?: string };

export const RESTORE_NOTE = "You can restore it for 30 days.";

// Leaving on your own.
export function leaveText(): StaysGoes {
  return {
    goesTitle: "What goes",
    stays: [
      "Your name on past expenses and payments",
      "The group’s history, to read (you can download it for 30 days)",
      "Your passport stamp for trips",
    ],
    goes: ["You won’t be in new expenses", "No notifications from this group", "You can’t add, edit or settle"],
    extra: "You can rejoin any time with the group’s link.",
  };
}

// The person who looks after the group removes someone.
export function removeText(name: string): StaysGoes {
  return {
    goesTitle: "What goes",
    stays: [
      `${name}’s name on past expenses and payments`,
      "The group’s history, to read (they can download it for 30 days)",
      "Their passport stamp for trips",
    ],
    goes: [`${name} won’t be in new expenses`, "No notifications from this group", "They can’t add, edit or settle"],
    extra: `${name} can’t rejoin on their own or with the old link. You can bring them back from People.`,
  };
}

// Deleting the whole group (only whoever looks after it can).
export function deleteText(): StaysGoes {
  return {
    goesTitle: "What goes, for everyone",
    stays: ["Postcards already sent", "Collections"],
    goes: [
      "The group disappears from everyone’s Home",
      "After 30 days it is erased for good: expenses, payments, history, bills, list, budgets, goals, the deposit record, the group photo and bill photos",
      "Passport stamps from it disappear",
    ],
    extra: RESTORE_NOTE,
  };
}

// Who can bring a deleted group back, as Home says it.
export const RESTORE_WHO = "Whoever deleted a group, or looks after it, can bring it back for 30 days.";
