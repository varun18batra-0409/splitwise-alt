# Load test

Seeded 400 people, 120 groups, 7874 expenses, 1238 payments in 12 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 95 / 101 | 875 / 922 | 2026 / 2080 | 0 |
| Busy trip: activity | 133 / 134 | 1209 / 1276 | 3116 / 3358 | 0 |
| Busy trip: balances | 88 / 88 | 753 / 784 | 1868 / 1884 | 0 |
| Busy trip (type trip): balances | 81 / 82 | 735 / 743 | 1904 / 1954 | 0 |
| Busy trip: charts | 136 / 139 | 1205 / 1248 | 3038 / 3101 | 0 |
| Busy trip: settle up | 42 / 46 | 331 / 335 | 832 / 860 | 0 |
| Settle across groups | 54 / 58 | 530 / 604 | 1232 / 1243 | 0 |
| Search “Expense 1” | 363 / 429 | 3444 / 3468 | 8796 / 9106 | 0 |
| Alerts | 54 / 151 | 470 / 477 | 1142 / 1186 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 90 | 42 | 2940 | 401 | 0 | 133 | Payment.groupBy 31 ms (20 rows) |
| Busy trip: activity | 127 | 13 | 12558 | 91 | 36 | 343 | Group.findUnique 83 ms (12448 rows) |
| Busy trip: balances | 83 | 9 | 2099 | 154 | 0 | 193 | Group.findUnique 48 ms (1583 rows) |
| Busy trip (type trip): balances | 88 | 8 | 2104 | 152 | 0 | 191 | Group.findUnique 52 ms (1583 rows) |
| Busy trip: charts | 127 | 8 | 12258 | 85 | 42 | 193 | Group.findUnique 77 ms (12148 rows) |
| Busy trip: settle up | 37 | 13 | 689 | 95 | 0 | 88 | raw.$queryRaw 18 ms (144 rows) |
| Settle across groups | 56 | 21 | 1141 | 207 | 0 | 219 | Payment.groupBy 29 ms (20 rows) |
| Search “Expense 1” | 348 | 79 | 33257 | 8150 | 0 | 432 | Expense.findMany 228 ms (1851 rows) |
| Alerts | 46 | 17 | 209 | 20 | 26 | 547 | Member.findMany 6 ms (17 rows) |
| Busy trip: balances, with Undo bar | 81 | 11 | 2102 | 154 | 0 | 194 | Group.findUnique 51 ms (1583 rows) |
| Trip I left: balances | 27 | 18 | 616 | 27 | 0 | 71 | Group.findUnique 5 ms (77 rows) |
| Trip I left: activity | 51 | 21 | 559 | 19 | 32 | 477 | Group.findUnique 6 ms (389 rows) |

Server busy-ness: the slowest second held the server's single thread up by 7465.86 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1465 ms in total (7 ms each on average).
Balances still add up to zero: yes ✓.