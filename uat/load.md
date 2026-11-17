# Load test

Seeded 400 people, 120 groups, 6161 expenses, 897 payments in 9 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 80 / 90 | 632 / 677 | 1503 / 1598 | 0 |
| Busy trip: activity | 217 / 236 | 1608 / 1744 | 4035 / 4082 | 0 |
| Busy trip: balances | 194 / 197 | 1430 / 1486 | 3392 / 3474 | 0 |
| Busy trip: charts | 195 / 198 | 1478 / 1567 | 3593 / 3676 | 0 |
| Busy trip: settle up | 46 / 51 | 377 / 384 | 918 / 922 | 0 |
| Settle across groups | 58 / 58 | 495 / 559 | 1105 / 1139 | 0 |
| Search “Expense 1” | 301 / 316 | 2386 / 2453 | 5857 / 5944 | 0 |
| Alerts | 78 / 81 | 688 / 737 | 1555 / 1600 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 72 | 30 | 1142 | 204 | 0 | 136 | Payment.groupBy 18 ms (19 rows) |
| Busy trip: activity | 225 | 15 | 99 | 185 | 40 | 407 | Group.findUnique 136 ms (1 rows) |
| Busy trip: balances | 188 | 12 | 99 | 170 | 18 | 190 | Group.findUnique 132 ms (1 rows) |
| Busy trip: charts | 197 | 12 | 99 | 174 | 23 | 241 | Group.findUnique 134 ms (1 rows) |
| Busy trip: settle up | 46 | 15 | 543 | 112 | 0 | 90 | raw.$queryRaw 23 ms (178 rows) |
| Settle across groups | 57 | 16 | 719 | 121 | 0 | 233 | Payment.groupBy 18 ms (19 rows) |
| Search “Expense 1” | 308 | 8 | 64 | 219 | 89 | 429 | Group.findMany 210 ms (21 rows) |
| Alerts | 79 | 17 | 197 | 27 | 52 | 557 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 184 | 14 | 101 | 169 | 15 | 192 | Group.findUnique 130 ms (1 rows) |
| Trip I left: balances | 35 | 16 | 153 | 25 | 10 | 74 | Group.findUnique 8 ms (1 rows) |
| Trip I left: activity | 78 | 20 | 153 | 37 | 41 | 488 | Group.findUnique 10 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2797.6 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2059 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.