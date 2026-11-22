// A small copy of a group, kept on the phone each time the group is opened online. Display only: nothing here is used to work out money.
// Worked out by the server (from the values the group page already computed) and labelled with the server's clock.
// NEVER holds a phone number or an email.
export type ActivityRowCopy = {
  id: string;
  title: string;
  category: string;
  line: string; // "Kabir paid ₹1,180"
  day: string; // the day it was spent, "2026-11-17" (the phone words it: Today, Yesterday, 17 Nov)
  effectLabel: string; // "you owe"
  effectAmount: string; // "₹200", or "" when not yours
  tone: "owe" | "owed" | "none";
};

export type Snapshot = {
  memberId: string; // you, in this group
  groupId: string;
  name: string;
  type: string;
  currency: string;
  cardMarkupBp: number;
  splitName: string;
  tz: string;
  peopleCount: number;
  dayLine: string; // "Day 5 of 5" for a trip under way, else ""
  members: { id: string; name: string; splitWeight: number }[]; // people still in the group
  balance: { paise: number; text: string; eq: string; tone: "owed" | "owe" | "square"; label: string; summary: string; canSettle: boolean };
  rows: ActivityRowCopy[]; // the 3 newest
  savedAt: string; // ISO, the server's clock
};
