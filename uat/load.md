# Load test

Seeded 400 people, 120 groups, 6143 expenses, 917 payments in 9 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 78 / 85 | 609 / 639 | 1418 / 1503 | 0 |
| Busy trip: activity | 201 / 203 | 1481 / 1595 | 3681 / 3712 | 0 |
| Busy trip: balances | 180 / 185 | 1295 / 1305 | 3151 / 3339 | 0 |
| Busy trip: charts | 186 / 188 | 1391 / 1402 | 3374 / 3430 | 0 |
| Busy trip: settle up | 45 / 48 | 372 / 426 | 869 / 874 | 0 |
| Settle across groups | 51 / 54 | 423 / 427 | 1054 / 1127 | 0 |
| Search “Expense 1” | 309 / 337 | 2322 / 2356 | 5693 / 5905 | 0 |
| Alerts | 79 / 80 | 634 / 646 | 1541 / 1667 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 73 | 30 | 1148 | 210 | 0 | 138 | Payment.groupBy 19 ms (20 rows) |
| Busy trip: activity | 208 | 15 | 99 | 178 | 30 | 360 | Group.findUnique 133 ms (1 rows) |
| Busy trip: balances | 181 | 12 | 99 | 169 | 12 | 189 | Group.findUnique 128 ms (1 rows) |
| Busy trip: charts | 188 | 12 | 99 | 166 | 22 | 241 | Group.findUnique 128 ms (1 rows) |
| Busy trip: settle up | 47 | 15 | 537 | 110 | 0 | 90 | raw.$queryRaw 20 ms (144 rows) |
| Settle across groups | 54 | 16 | 725 | 119 | 0 | 212 | Payment.groupBy 18 ms (20 rows) |
| Search “Expense 1” | 309 | 8 | 64 | 215 | 94 | 431 | Group.findMany 207 ms (21 rows) |
| Alerts | 78 | 17 | 198 | 27 | 51 | 557 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 185 | 14 | 101 | 169 | 16 | 191 | Group.findUnique 129 ms (1 rows) |
| Trip I left: balances | 36 | 16 | 153 | 26 | 10 | 72 | Group.findUnique 8 ms (1 rows) |
| Trip I left: activity | 214 | 20 | 153 | 30 | 184 | 2221 | Group.findUnique 10 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2768.24 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2084 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.