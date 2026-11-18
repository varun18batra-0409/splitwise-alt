# Load test

Seeded 400 people, 120 groups, 6241 expenses, 916 payments in 10 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 104 / 110 | 881 / 951 | 2100 / 2202 | 0 |
| Busy trip: activity | 268 / 328 | 2093 / 2176 | 4982 / 5146 | 0 |
| Busy trip: balances | 227 / 235 | 1685 / 1747 | 4297 / 4509 | 0 |
| Busy trip: charts | 231 / 233 | 1701 / 1741 | 4335 / 4477 | 0 |
| Busy trip: settle up | 54 / 60 | 453 / 457 | 1145 / 1175 | 0 |
| Settle across groups | 72 / 76 | 652 / 727 | 1465 / 1476 | 0 |
| Search “Expense 1” | 388 / 412 | 3105 / 3222 | 7713 / 7836 | 0 |
| Alerts | 106 / 116 | 839 / 900 | 1988 / 2023 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 94 | 37 | 1208 | 348 | 0 | 139 | Block.findMany 24 ms (0 rows) |
| Busy trip: activity | 258 | 15 | 99 | 223 | 35 | 446 | Group.findUnique 162 ms (1 rows) |
| Busy trip: balances | 217 | 12 | 99 | 201 | 16 | 198 | Group.findUnique 150 ms (1 rows) |
| Busy trip: charts | 225 | 12 | 99 | 207 | 18 | 198 | Group.findUnique 159 ms (1 rows) |
| Busy trip: settle up | 56 | 15 | 543 | 133 | 0 | 94 | raw.$queryRaw 23 ms (181 rows) |
| Settle across groups | 71 | 21 | 765 | 192 | 0 | 196 | Expense.groupBy 25 ms (20 rows) |
| Search “Expense 1” | 403 | 11 | 64 | 278 | 125 | 445 | Group.findMany 272 ms (21 rows) |
| Alerts | 103 | 18 | 204 | 42 | 61 | 558 | GroupEvent.findMany 6 ms (100 rows) |
| Busy trip: balances, with Undo bar | 230 | 14 | 101 | 211 | 19 | 199 | Group.findUnique 152 ms (1 rows) |
| Trip I left: balances | 47 | 20 | 153 | 46 | 1 | 75 | Group.findUnique 9 ms (1 rows) |
| Trip I left: activity | 102 | 24 | 153 | 54 | 48 | 512 | Group.findUnique 11 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 3747.61 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2406 ms in total (12 ms each on average).
Balances still add up to zero: yes ✓.