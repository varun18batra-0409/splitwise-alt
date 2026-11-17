# Load test

Seeded 400 people, 120 groups, 6101 expenses, 887 payments in 11 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 114 / 122 | 929 / 1032 | 2216 / 2354 | 0 |
| Busy trip: activity | 286 / 325 | 2361 / 2410 | 5737 / 5823 | 0 |
| Busy trip: balances | 260 / 327 | 2017 / 2140 | 4971 / 5141 | 0 |
| Busy trip: charts | 269 / 280 | 2124 / 2249 | 5236 / 5403 | 0 |
| Busy trip: settle up | 63 / 63 | 516 / 529 | 1324 / 1363 | 0 |
| Settle across groups | 86 / 88 | 689 / 697 | 1728 / 1831 | 0 |
| Search “Expense 1” | 465 / 508 | 3652 / 3716 | 8954 / 9045 | 0 |
| Alerts | 113 / 117 | 1016 / 1060 | 2500 / 2591 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 102 | 30 | 1230 | 315 | 0 | 136 | GroupEvent.findMany 28 ms (0 rows) |
| Busy trip: activity | 293 | 15 | 99 | 251 | 42 | 360 | Group.findUnique 187 ms (1 rows) |
| Busy trip: balances | 253 | 12 | 99 | 228 | 25 | 189 | Group.findUnique 177 ms (1 rows) |
| Busy trip: charts | 264 | 12 | 99 | 229 | 35 | 236 | Group.findUnique 176 ms (1 rows) |
| Busy trip: settle up | 61 | 15 | 523 | 154 | 0 | 91 | raw.$queryRaw 28 ms (167 rows) |
| Settle across groups | 77 | 16 | 819 | 188 | 0 | 220 | GroupEvent.findMany 27 ms (0 rows) |
| Search “Expense 1” | 444 | 8 | 64 | 301 | 143 | 435 | Group.findMany 288 ms (21 rows) |
| Alerts | 109 | 17 | 217 | 35 | 74 | 557 | GroupEvent.findMany 6 ms (100 rows) |
| Busy trip: balances, with Undo bar | 251 | 14 | 101 | 229 | 22 | 191 | Group.findUnique 172 ms (1 rows) |
| Trip I left: balances | 44 | 16 | 153 | 33 | 11 | 72 | Group.findUnique 10 ms (1 rows) |
| Trip I left: activity | 297 | 20 | 153 | 38 | 259 | 2055 | Group.findUnique 12 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 4194.3 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2745 ms in total (14 ms each on average).
Balances still add up to zero: yes ✓.