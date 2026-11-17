# Load test

Seeded 400 people, 120 groups, 5756 expenses, 887 payments in 12 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 127 / 130 | 932 / 1096 | 2312 / 2453 | 0 |
| Busy trip: activity | 321 / 352 | 2514 / 2719 | 6216 / 6284 | 0 |
| Busy trip: balances | 287 / 296 | 2238 / 2352 | 5322 / 5597 | 0 |
| Busy trip: charts | 304 / 308 | 2207 / 2314 | 5658 / 5786 | 0 |
| Busy trip: settle up | 71 / 84 | 528 / 563 | 1417 / 1480 | 0 |
| Settle across groups | 82 / 84 | 648 / 697 | 1594 / 1796 | 0 |
| Search “Expense 1” | 524 / 534 | 3882 / 3954 | 9669 / 9797 | 0 |
| Alerts | 114 / 125 | 1069 / 1090 | 2559 / 2714 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 110 | 30 | 1219 | 350 | 0 | 136 | Payment.groupBy 34 ms (19 rows) |
| Busy trip: activity | 334 | 15 | 99 | 291 | 43 | 402 | Group.findUnique 223 ms (1 rows) |
| Busy trip: balances | 296 | 12 | 99 | 262 | 34 | 190 | Group.findUnique 213 ms (1 rows) |
| Busy trip: charts | 303 | 12 | 99 | 272 | 31 | 241 | Group.findUnique 213 ms (1 rows) |
| Busy trip: settle up | 63 | 15 | 536 | 162 | 0 | 90 | raw.$queryRaw 31 ms (144 rows) |
| Settle across groups | 82 | 16 | 777 | 199 | 0 | 211 | GroupEvent.findMany 30 ms (0 rows) |
| Search “Expense 1” | 518 | 8 | 64 | 349 | 169 | 437 | Group.findMany 338 ms (21 rows) |
| Alerts | 126 | 17 | 203 | 44 | 82 | 557 | GroupEvent.findMany 8 ms (100 rows) |
| Busy trip: balances, with Undo bar | 294 | 14 | 101 | 267 | 27 | 191 | Group.findUnique 196 ms (1 rows) |
| Trip I left: balances | 46 | 16 | 153 | 37 | 9 | 72 | Group.findUnique 11 ms (1 rows) |
| Trip I left: activity | 315 | 20 | 153 | 42 | 273 | 2045 | Group.findUnique 13 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 4819.26 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 3098 ms in total (15 ms each on average).
Balances still add up to zero: yes ✓.