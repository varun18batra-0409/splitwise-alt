# Load test

Seeded 400 people, 120 groups, 6252 expenses, 877 payments in 9 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 71 / 79 | 616 / 666 | 1379 / 1453 | 0 |
| Busy trip: activity | 130 / 139 | 1261 / 1348 | 3089 / 3132 | 0 |
| Busy trip: balances | 124 / 199 | 1090 / 1173 | 2780 / 2805 | 0 |
| Busy trip: charts | 132 / 199 | 1168 / 1259 | 2839 / 2862 | 0 |
| Busy trip: settle up | 37 / 94 | 304 / 324 | 763 / 783 | 0 |
| Settle across groups | 43 / 46 | 389 / 402 | 1020 / 1133 | 0 |
| Search “Expense 1” | 207 / 269 | 1935 / 1967 | 4860 / 4991 | 0 |
| Alerts | 50 / 64 | 453 / 477 | 1107 / 1138 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 60 | 37 | 1346 | 313 | 0 | 133 | Member.findMany 24 ms (0 rows) |
| Busy trip: activity | 127 | 15 | 99 | 87 | 40 | 432 | Group.findUnique 76 ms (1 rows) |
| Busy trip: balances | 113 | 12 | 99 | 78 | 35 | 192 | Group.findUnique 71 ms (1 rows) |
| Busy trip: charts | 121 | 12 | 99 | 77 | 44 | 194 | Group.findUnique 70 ms (1 rows) |
| Busy trip: settle up | 38 | 15 | 536 | 108 | 0 | 89 | raw.$queryRaw 19 ms (175 rows) |
| Settle across groups | 47 | 21 | 748 | 144 | 0 | 223 | Payment.groupBy 20 ms (19 rows) |
| Search “Expense 1” | 196 | 11 | 64 | 127 | 69 | 429 | Group.findMany 119 ms (21 rows) |
| Alerts | 45 | 18 | 202 | 18 | 27 | 546 | GroupEvent.findMany 3 ms (100 rows) |
| Busy trip: balances, with Undo bar | 114 | 14 | 101 | 78 | 36 | 194 | Group.findUnique 71 ms (1 rows) |
| Trip I left: balances | 22 | 20 | 153 | 15 | 7 | 72 | Group.findUnique 5 ms (1 rows) |
| Trip I left: activity | 49 | 24 | 153 | 18 | 31 | 477 | Group.findUnique 5 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 4158.65 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1239 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.