# Load test

Seeded 400 people, 120 groups, 6499 expenses, 936 payments in 9 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 78 / 86 | 635 / 682 | 1536 / 1610 | 0 |
| Busy trip: activity | 202 / 213 | 1542 / 1619 | 3850 / 3916 | 0 |
| Busy trip: balances | 183 / 190 | 1363 / 1401 | 3221 / 3387 | 0 |
| Busy trip: charts | 183 / 188 | 1386 / 1454 | 3430 / 3473 | 0 |
| Busy trip: settle up | 45 / 49 | 361 / 362 | 902 / 906 | 0 |
| Settle across groups | 54 / 59 | 451 / 455 | 1165 / 1243 | 0 |
| Search “Expense 1” | 332 / 342 | 2471 / 2554 | 5979 / 6124 | 0 |
| Alerts | 70 / 74 | 631 / 695 | 1497 / 1537 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 75 | 30 | 1293 | 217 | 0 | 136 | Payment.groupBy 21 ms (19 rows) |
| Busy trip: activity | 206 | 15 | 99 | 178 | 28 | 360 | Group.findUnique 132 ms (1 rows) |
| Busy trip: balances | 175 | 12 | 99 | 161 | 14 | 189 | Group.findUnique 126 ms (1 rows) |
| Busy trip: charts | 179 | 12 | 99 | 160 | 19 | 241 | Group.findUnique 124 ms (1 rows) |
| Busy trip: settle up | 43 | 15 | 534 | 108 | 0 | 96 | raw.$queryRaw 20 ms (171 rows) |
| Settle across groups | 52 | 16 | 813 | 126 | 0 | 222 | Payment.groupBy 18 ms (19 rows) |
| Search “Expense 1” | 318 | 8 | 64 | 227 | 91 | 432 | Group.findMany 222 ms (21 rows) |
| Alerts | 73 | 17 | 206 | 26 | 47 | 557 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 173 | 14 | 101 | 161 | 12 | 191 | Group.findUnique 126 ms (1 rows) |
| Trip I left: balances | 32 | 16 | 153 | 27 | 5 | 72 | Group.findUnique 8 ms (1 rows) |
| Trip I left: activity | 187 | 20 | 153 | 32 | 155 | 1885 | Group.findUnique 11 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2860.52 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2030 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.