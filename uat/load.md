# Load test

Seeded 400 people, 120 groups, 6247 expenses, 911 payments in 11 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 115 / 123 | 982 / 1083 | 2313 / 2478 | 0 |
| Busy trip: activity | 324 / 336 | 2586 / 2778 | 6500 / 6559 | 0 |
| Busy trip: balances | 262 / 267 | 2010 / 2030 | 5081 / 5092 | 0 |
| Busy trip: charts | 263 / 267 | 2075 / 2080 | 5249 / 5311 | 0 |
| Busy trip: settle up | 61 / 68 | 548 / 556 | 1335 / 1347 | 0 |
| Settle across groups | 110 / 119 | 987 / 1000 | 2452 / 2632 | 0 |
| Search “Expense 1” | 452 / 480 | 3609 / 3726 | 9083 / 9190 | 0 |
| Alerts | 113 / 114 | 992 / 1003 | 2442 / 2543 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 104 | 33 | 1245 | 361 | 0 | 153 | Payment.findMany 34 ms (0 rows) |
| Busy trip: activity | 321 | 11 | 85 | 243 | 78 | 632 | Group.findUnique 189 ms (1 rows) |
| Busy trip: balances | 245 | 8 | 85 | 222 | 23 | 198 | Group.findUnique 177 ms (1 rows) |
| Busy trip: charts | 260 | 8 | 85 | 223 | 37 | 248 | Group.findUnique 173 ms (1 rows) |
| Busy trip: settle up | 60 | 16 | 529 | 164 | 0 | 99 | raw.$queryRaw 30 ms (186 rows) |
| Settle across groups | 117 | 16 | 840 | 209 | 0 | 490 | Payment.groupBy 29 ms (20 rows) |
| Search “Expense 1” | 445 | 7 | 64 | 302 | 143 | 463 | Group.findMany 295 ms (21 rows) |
| Alerts | 109 | 18 | 205 | 35 | 74 | 558 | GroupEvent.findMany 6 ms (100 rows) |
| Busy trip: balances, with Undo bar | 250 | 10 | 87 | 222 | 28 | 199 | Group.findUnique 178 ms (1 rows) |
| Trip I left: balances | 38 | 9 | 145 | 24 | 14 | 82 | Group.findUnique 10 ms (1 rows) |
| Trip I left: activity | 276 | 13 | 145 | 31 | 245 | 1994 | Group.findUnique 12 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 4133.49 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2631 ms in total (13 ms each on average).
Balances still add up to zero: yes ✓.