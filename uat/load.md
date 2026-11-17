# Load test

Seeded 400 people, 120 groups, 6171 expenses, 900 payments in 12 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 116 / 131 | 987 / 1071 | 2271 / 2531 | 0 |
| Busy trip: activity | 309 / 316 | 2443 / 2634 | 6099 / 6317 | 0 |
| Busy trip: balances | 264 / 275 | 2157 / 2232 | 5178 / 5339 | 0 |
| Busy trip: charts | 286 / 291 | 2177 / 2291 | 5436 / 5574 | 0 |
| Busy trip: settle up | 65 / 73 | 548 / 595 | 1441 / 1459 | 0 |
| Settle across groups | 77 / 80 | 674 / 682 | 1749 / 1810 | 0 |
| Search “Expense 1” | 470 / 478 | 3716 / 3750 | 9434 / 9759 | 0 |
| Alerts | 120 / 121 | 1064 / 1078 | 2562 / 2648 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 101 | 31 | 1254 | 316 | 0 | 137 | GroupEvent.findMany 29 ms (0 rows) |
| Busy trip: activity | 321 | 15 | 99 | 263 | 58 | 446 | Group.findUnique 199 ms (1 rows) |
| Busy trip: balances | 274 | 12 | 99 | 250 | 24 | 190 | Group.findUnique 188 ms (1 rows) |
| Busy trip: charts | 280 | 12 | 99 | 244 | 36 | 241 | Group.findUnique 186 ms (1 rows) |
| Busy trip: settle up | 67 | 15 | 544 | 167 | 0 | 93 | raw.$queryRaw 29 ms (181 rows) |
| Settle across groups | 81 | 16 | 792 | 197 | 0 | 199 | GroupEvent.findMany 27 ms (0 rows) |
| Search “Expense 1” | 491 | 8 | 64 | 335 | 156 | 436 | Group.findMany 324 ms (21 rows) |
| Alerts | 120 | 17 | 213 | 34 | 86 | 557 | GroupEvent.findMany 7 ms (100 rows) |
| Busy trip: balances, with Undo bar | 268 | 14 | 101 | 244 | 24 | 192 | Group.findUnique 205 ms (1 rows) |
| Trip I left: balances | 46 | 16 | 153 | 35 | 11 | 72 | Group.findUnique 11 ms (1 rows) |
| Trip I left: activity | 289 | 20 | 153 | 45 | 244 | 1845 | Group.findUnique 14 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 4208.98 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2896 ms in total (14 ms each on average).
Balances still add up to zero: yes ✓.