# Load test

Seeded 400 people, 120 groups, 6209 expenses, 941 payments in 11 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 130 / 145 | 1164 / 1295 | 2723 / 2969 | 0 |
| Busy trip: activity | 308 / 318 | 2364 / 2428 | 5822 / 5844 | 0 |
| Busy trip: balances | 255 / 258 | 1986 / 1992 | 5042 / 5082 | 0 |
| Busy trip: charts | 265 / 273 | 2076 / 2089 | 5207 / 5228 | 0 |
| Busy trip: settle up | 66 / 69 | 549 / 553 | 1363 / 1381 | 0 |
| Settle across groups | 166 / 167 | 1479 / 1587 | 3674 / 3767 | 0 |
| Search “Expense 1” | 447 / 448 | 3561 / 3582 | 8945 / 9013 | 0 |
| Alerts | 109 / 111 | 980 / 1000 | 2426 / 2482 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 119 | 75 | 1255 | 902 | 0 | 178 | Payment.findMany 37 ms (0 rows) |
| Busy trip: activity | 286 | 12 | 86 | 241 | 45 | 390 | Group.findUnique 195 ms (1 rows) |
| Busy trip: balances | 248 | 9 | 86 | 225 | 23 | 189 | Group.findUnique 174 ms (1 rows) |
| Busy trip: charts | 262 | 9 | 86 | 225 | 37 | 241 | Group.findUnique 172 ms (1 rows) |
| Busy trip: settle up | 63 | 16 | 542 | 166 | 0 | 111 | raw.$queryRaw 28 ms (189 rows) |
| Settle across groups | 157 | 16 | 808 | 179 | 0 | 873 | Payment.groupBy 27 ms (19 rows) |
| Search “Expense 1” | 432 | 7 | 64 | 297 | 135 | 435 | Group.findMany 294 ms (21 rows) |
| Alerts | 117 | 18 | 206 | 40 | 77 | 557 | GroupEvent.findMany 6 ms (100 rows) |
| Busy trip: balances, with Undo bar | 244 | 11 | 88 | 224 | 20 | 191 | Group.findUnique 181 ms (1 rows) |
| Trip I left: balances | 37 | 10 | 146 | 25 | 12 | 71 | Group.findUnique 10 ms (1 rows) |
| Trip I left: activity | 259 | 14 | 146 | 32 | 227 | 1881 | Group.findUnique 13 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 4091.54 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2617 ms in total (13 ms each on average).
Balances still add up to zero: yes ✓.