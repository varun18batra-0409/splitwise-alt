# Load test

Seeded 400 people, 120 groups, 6227 expenses, 951 payments in 9 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 81 / 84 | 659 / 691 | 1598 / 1654 | 0 |
| Busy trip: activity | 205 / 216 | 1510 / 1696 | 3820 / 3834 | 0 |
| Busy trip: balances | 186 / 188 | 1381 / 1397 | 3344 / 3450 | 0 |
| Busy trip: charts | 190 / 198 | 1450 / 1508 | 3438 / 3559 | 0 |
| Busy trip: settle up | 45 / 52 | 372 / 379 | 918 / 1002 | 0 |
| Settle across groups | 65 / 71 | 466 / 477 | 1105 / 1142 | 0 |
| Search “Expense 1” | 331 / 331 | 2458 / 2615 | 6234 / 6329 | 0 |
| Alerts | 84 / 108 | 674 / 686 | 1616 / 1744 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 79 | 37 | 1241 | 247 | 0 | 137 | Payment.groupBy 20 ms (20 rows) |
| Busy trip: activity | 207 | 15 | 99 | 183 | 24 | 350 | Group.findUnique 136 ms (1 rows) |
| Busy trip: balances | 190 | 12 | 99 | 174 | 16 | 191 | Group.findUnique 133 ms (1 rows) |
| Busy trip: charts | 199 | 12 | 99 | 177 | 22 | 198 | Group.findUnique 151 ms (1 rows) |
| Busy trip: settle up | 48 | 15 | 541 | 114 | 0 | 90 | raw.$queryRaw 22 ms (183 rows) |
| Settle across groups | 59 | 21 | 792 | 152 | 0 | 190 | Payment.groupBy 18 ms (20 rows) |
| Search “Expense 1” | 327 | 11 | 64 | 232 | 95 | 432 | Group.findMany 219 ms (21 rows) |
| Alerts | 84 | 18 | 207 | 31 | 53 | 558 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 191 | 14 | 101 | 175 | 16 | 192 | Group.findUnique 130 ms (1 rows) |
| Trip I left: balances | 38 | 20 | 153 | 32 | 6 | 73 | Group.findUnique 8 ms (1 rows) |
| Trip I left: activity | 80 | 24 | 153 | 41 | 39 | 454 | Group.findUnique 10 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2896.17 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1790 ms in total (9 ms each on average).
Balances still add up to zero: yes ✓.