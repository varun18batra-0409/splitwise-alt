# Load test

Seeded 400 people, 120 groups, 6113 expenses, 932 payments in 9 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 84 / 92 | 653 / 697 | 1552 / 1657 | 0 |
| Busy trip: activity | 217 / 219 | 1575 / 1722 | 4048 / 4093 | 0 |
| Busy trip: balances | 190 / 191 | 1402 / 1427 | 3338 / 3523 | 0 |
| Busy trip: charts | 199 / 203 | 1468 / 1486 | 3492 / 3591 | 0 |
| Busy trip: settle up | 46 / 48 | 361 / 371 | 898 / 906 | 0 |
| Settle across groups | 57 / 62 | 452 / 455 | 1131 / 1218 | 0 |
| Search “Expense 1” | 323 / 343 | 2512 / 2676 | 6322 / 6349 | 0 |
| Alerts | 77 / 80 | 665 / 721 | 1533 / 1606 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 70 | 31 | 1216 | 217 | 0 | 136 | Payment.groupBy 20 ms (19 rows) |
| Busy trip: activity | 213 | 15 | 99 | 178 | 35 | 407 | Group.findUnique 132 ms (1 rows) |
| Busy trip: balances | 186 | 12 | 99 | 167 | 19 | 190 | Group.findUnique 130 ms (1 rows) |
| Busy trip: charts | 196 | 12 | 99 | 169 | 27 | 241 | Group.findUnique 129 ms (1 rows) |
| Busy trip: settle up | 43 | 15 | 533 | 109 | 0 | 89 | raw.$queryRaw 22 ms (173 rows) |
| Settle across groups | 54 | 16 | 788 | 127 | 0 | 200 | GroupEvent.findMany 19 ms (0 rows) |
| Search “Expense 1” | 324 | 8 | 64 | 233 | 91 | 431 | Group.findMany 225 ms (21 rows) |
| Alerts | 79 | 18 | 199 | 29 | 50 | 557 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 182 | 14 | 101 | 166 | 16 | 191 | Group.findUnique 127 ms (1 rows) |
| Trip I left: balances | 36 | 16 | 153 | 26 | 10 | 72 | Group.findUnique 8 ms (1 rows) |
| Trip I left: activity | 212 | 20 | 153 | 33 | 179 | 2234 | Group.findUnique 10 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 3191.87 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2079 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.