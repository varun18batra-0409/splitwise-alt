# Load test

Seeded 400 people, 120 groups, 6139 expenses, 855 payments in 9 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 95 / 112 | 748 / 831 | 1714 / 1820 | 0 |
| Busy trip: activity | 215 / 221 | 1586 / 1719 | 3917 / 3933 | 0 |
| Busy trip: balances | 196 / 199 | 1396 / 1478 | 3467 / 3480 | 0 |
| Busy trip: charts | 198 / 204 | 1449 / 1467 | 3575 / 3628 | 0 |
| Busy trip: settle up | 49 / 55 | 385 / 388 | 957 / 1046 | 0 |
| Settle across groups | 64 / 70 | 531 / 535 | 1273 / 1288 | 0 |
| Search “Expense 1” | 327 / 334 | 2526 / 2584 | 6042 / 6180 | 0 |
| Alerts | 91 / 109 | 651 / 657 | 1638 / 1681 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 90 | 37 | 1274 | 337 | 0 | 139 | Block.findMany 23 ms (0 rows) |
| Busy trip: activity | 213 | 15 | 99 | 195 | 18 | 355 | Group.findUnique 141 ms (1 rows) |
| Busy trip: balances | 190 | 12 | 99 | 176 | 14 | 198 | Group.findUnique 134 ms (1 rows) |
| Busy trip: charts | 193 | 12 | 99 | 175 | 18 | 198 | Group.findUnique 132 ms (1 rows) |
| Busy trip: settle up | 49 | 15 | 541 | 117 | 0 | 90 | raw.$queryRaw 21 ms (144 rows) |
| Settle across groups | 68 | 21 | 816 | 169 | 0 | 240 | Payment.groupBy 20 ms (19 rows) |
| Search “Expense 1” | 318 | 11 | 64 | 233 | 85 | 443 | Group.findMany 218 ms (21 rows) |
| Alerts | 81 | 18 | 203 | 37 | 44 | 558 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 185 | 14 | 101 | 173 | 12 | 199 | Group.findUnique 129 ms (1 rows) |
| Trip I left: balances | 42 | 20 | 153 | 41 | 1 | 75 | Group.findUnique 9 ms (1 rows) |
| Trip I left: activity | 89 | 24 | 153 | 48 | 41 | 520 | Group.findUnique 10 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2772.43 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2090 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.