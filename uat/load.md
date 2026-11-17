# Load test

Seeded 400 people, 120 groups, 5991 expenses, 863 payments in 8 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 76 / 84 | 602 / 647 | 1476 / 1516 | 0 |
| Busy trip: activity | 203 / 249 | 1536 / 1568 | 3718 / 3844 | 0 |
| Busy trip: balances | 178 / 180 | 1281 / 1290 | 3191 / 3326 | 0 |
| Busy trip: charts | 184 / 185 | 1327 / 1361 | 3409 / 3431 | 0 |
| Busy trip: settle up | 43 / 47 | 347 / 367 | 865 / 872 | 0 |
| Settle across groups | 51 / 54 | 413 / 419 | 1026 / 1145 | 0 |
| Search “Expense 1” | 312 / 333 | 2340 / 2450 | 5857 / 5903 | 0 |
| Alerts | 71 / 77 | 612 / 698 | 1472 / 1539 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 68 | 30 | 1320 | 213 | 0 | 136 | Expense.groupBy 21 ms (20 rows) |
| Busy trip: activity | 199 | 15 | 99 | 175 | 24 | 403 | Group.findUnique 131 ms (1 rows) |
| Busy trip: balances | 169 | 12 | 99 | 157 | 12 | 190 | Group.findUnique 122 ms (1 rows) |
| Busy trip: charts | 179 | 12 | 99 | 157 | 22 | 241 | Group.findUnique 121 ms (1 rows) |
| Busy trip: settle up | 41 | 15 | 554 | 109 | 0 | 90 | raw.$queryRaw 20 ms (190 rows) |
| Settle across groups | 50 | 16 | 879 | 131 | 0 | 194 | Payment.groupBy 19 ms (19 rows) |
| Search “Expense 1” | 298 | 8 | 64 | 212 | 86 | 435 | Group.findMany 207 ms (21 rows) |
| Alerts | 69 | 17 | 200 | 29 | 40 | 557 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 171 | 14 | 102 | 157 | 14 | 191 | Group.findUnique 120 ms (1 rows) |
| Trip I left: balances | 31 | 16 | 153 | 25 | 6 | 72 | Group.findUnique 8 ms (1 rows) |
| Trip I left: activity | 207 | 20 | 153 | 28 | 179 | 2488 | Group.findUnique 9 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2910.85 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2018 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.