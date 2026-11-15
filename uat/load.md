# Load test

Seeded 400 people, 120 groups, 6388 expenses, 860 payments in 9 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 75 / 78 | 605 / 660 | 1492 / 1521 | 0 |
| Busy trip: activity | 219 / 224 | 1644 / 1763 | 4087 / 4113 | 0 |
| Busy trip: balances | 178 / 200 | 1331 / 1364 | 3296 / 3366 | 0 |
| Busy trip: charts | 193 / 197 | 1400 / 1412 | 3442 / 3555 | 0 |
| Busy trip: settle up | 47 / 58 | 381 / 390 | 958 / 1032 | 0 |
| Settle across groups | 57 / 57 | 451 / 465 | 1104 / 1113 | 0 |
| Search “Expense 1” | 322 / 389 | 2376 / 2461 | 5818 / 5941 | 0 |
| Alerts | 76 / 86 | 610 / 631 | 1539 / 1644 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 68 | 29 | 1181 | 214 | 0 | 128 | Payment.groupBy 20 ms (17 rows) |
| Busy trip: activity | 211 | 13 | 98 | 174 | 37 | 520 | Group.findUnique 132 ms (1 rows) |
| Busy trip: balances | 178 | 10 | 98 | 163 | 15 | 189 | Group.findUnique 131 ms (1 rows) |
| Busy trip: charts | 185 | 10 | 98 | 163 | 22 | 241 | Group.findUnique 127 ms (1 rows) |
| Busy trip: settle up | 45 | 17 | 537 | 112 | 0 | 96 | raw.$queryRaw 19 ms (182 rows) |
| Settle across groups | 55 | 16 | 772 | 137 | 0 | 221 | GroupEvent.findMany 20 ms (0 rows) |
| Search “Expense 1” | 315 | 7 | 64 | 228 | 87 | 435 | Group.findMany 212 ms (21 rows) |
| Alerts | 78 | 18 | 199 | 28 | 50 | 557 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 181 | 12 | 100 | 160 | 21 | 191 | Group.findUnique 124 ms (1 rows) |
| Trip I left: balances | 31 | 14 | 152 | 24 | 7 | 72 | Group.findUnique 8 ms (1 rows) |
| Trip I left: activity | 186 | 18 | 152 | 28 | 158 | 1921 | Group.findUnique 11 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2936.01 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2106 ms in total (11 ms each on average).
Balances still add up to zero: yes ✓.