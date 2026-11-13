---
name: financial-test-generator
description: Use to generate and check hard money scenarios for Loopin — awkward splits, several payers, refunds, foreign currency with card fees, people leaving, undo and settle-up — as tests with expected numbers worked out by hand.
---

# Financial test generator

A money test is only worth something if the expected numbers were worked out independently of the code. Write the arithmetic in a comment next to each expectation.

## How to write one
- Vitest, in `tests/` (look at `split.test.ts`, `settle.test.ts`, `refunds.test.ts`, `scenarios.test.ts`, `money-races.test.ts` for the style). Pure functions first; database-backed scenarios use the throwaway test database the existing tests use — never staging data you didn't create, never production.
- Amounts in minor units (₹100 = `10000`).
- Every scenario asserts the invariants as well as the numbers:
  1. sum of payers = sum of shares = expense amount;
  2. all balances in the group add up to exactly 0;
  3. after the suggested settle-up payments are recorded, everyone is exactly 0;
  4. no one's balance changed who wasn't part of the action.

## Scenario catalogue (pick the ones the change touches; add new ones here)
- ₹100 split 3 ways (33.34 / 33.33 / 33.33 — who gets the extra paisa, deterministically).
- 7 people with weights 1,1,2,2,3,3,5 on ₹1,000.01.
- Percentages that sum to 99.99%; exact amounts that are ₹0.01 off.
- Two payers on one expense; a payer who isn't in the split.
- Split by item with tax and tip spread.
- A refund bigger than one person's share.
- THB 1,234 in an INR group at a saved rate, with a 3% card fee: fee added once; rate never re-read.
- JPY (no decimals) and KWD (3 decimals) groups.
- Edit an expense after a payment was recorded; delete then restore; undo then redo.
- Someone leaves owing nothing; someone can't leave while owing; their history stays.
- Moving in or out of a flat mid-month: pro-rata shares keep the bill total.
- Part payment, over-payment (asks first), payment claimed then confirmed, then "not received".
- Settle across groups; settle-all.
- Double tap and two people saving at once: recorded once.
- Pot (card night) results kept out of spending totals.

## Report
For each scenario: inputs, hand-worked expected result, what the code gave, pass or fail as actually run. Never mark a scenario passed without running it.
