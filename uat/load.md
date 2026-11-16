# Load test

Seeded 400 people, 120 groups, 6270 expenses, 855 payments in 9 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 80 / 85 | 632 / 687 | 1507 / 1594 | 0 |
| Busy trip: activity | 201 / 206 | 1493 / 1623 | 3744 / 3832 | 0 |
| Busy trip: balances | 177 / 181 | 1353 / 1405 | 3244 / 3298 | 0 |
| Busy trip: charts | 188 / 203 | 1387 / 1396 | 3468 / 3534 | 0 |
| Busy trip: settle up | 42 / 49 | 354 / 366 | 885 / 893 | 0 |
| Settle across groups | 53 / 55 | 448 / 457 | 1153 / 1196 | 0 |
| Search “Expense 1” | 301 / 318 | 2408 / 2453 | 5769 / 5944 | 0 |
| Alerts | 77 / 78 | 637 / 649 | 1515 / 1642 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 68 | 29 | 1251 | 205 | 0 | 137 | Payment.groupBy 18 ms (18 rows) |
| Busy trip: activity | 204 | 14 | 99 | 177 | 27 | 390 | Group.findUnique 135 ms (1 rows) |
| Busy trip: balances | 180 | 11 | 99 | 161 | 19 | 190 | Group.findUnique 123 ms (1 rows) |
| Busy trip: charts | 185 | 11 | 99 | 161 | 24 | 241 | Group.findUnique 127 ms (1 rows) |
| Busy trip: settle up | 46 | 18 | 542 | 117 | 0 | 88 | raw.$queryRaw 22 ms (144 rows) |
| Settle across groups | 54 | 16 | 798 | 133 | 0 | 223 | GroupEvent.findMany 20 ms (0 rows) |
| Search “Expense 1” | 307 | 7 | 64 | 221 | 86 | 431 | Group.findMany 217 ms (21 rows) |
| Alerts | 78 | 18 | 208 | 35 | 43 | 557 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 180 | 13 | 101 | 166 | 14 | 191 | Group.findUnique 126 ms (1 rows) |
| Trip I left: balances | 32 | 15 | 153 | 24 | 8 | 72 | Group.findUnique 8 ms (1 rows) |
| Trip I left: activity | 215 | 19 | 153 | 30 | 185 | 2300 | Group.findUnique 9 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2824.86 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2043 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.