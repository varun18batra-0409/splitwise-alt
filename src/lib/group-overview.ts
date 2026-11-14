import { buildActivity, type ActivityItem } from "./activity";

// The Overview's "Recent expenses": the first few rows of the very list the Expenses tab shows (same builder, same rows, so refunds and deleted
// items read the same and every amount is the same figure). Group changes ("renamed the group") are history, not expenses, so they are left out.
export function recentRows(expenses: Parameters<typeof buildActivity>[0], payments: Parameters<typeof buildActivity>[1], myId: string, n = 3): ActivityItem[] {
  return buildActivity(expenses, payments, myId).slice(0, n);
}
