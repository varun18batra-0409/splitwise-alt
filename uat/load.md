# Load test

Seeded 400 people, 120 groups, 7348 expenses, 1216 payments in 14 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 101 / 105 | 913 / 957 | 2111 / 2166 | 0 |
| Busy trip: activity | 158 / 161 | 1548 / 1573 | 3906 / 4252 | 0 |
| Busy trip: balances | 92 / 137 | 878 / 898 | 2144 / 2319 | 0 |
| Busy trip (type trip): balances | 94 / 96 | 862 / 877 | 2075 / 2124 | 0 |
| Busy trip: charts | 157 / 157 | 1443 / 1466 | 3513 / 3551 | 0 |
| Busy trip: settle up | 42 / 60 | 372 / 413 | 919 / 950 | 0 |
| Settle across groups | 63 / 72 | 577 / 588 | 1514 / 1526 | 0 |
| Search “Expense 1” | 371 / 381 | 3642 / 3746 | 9207 / 9559 | 0 |
| Alerts | 101 / 127 | 689 / 839 | 1427 / 1646 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 94 | 41 | 2735 | 497 | 0 | 133 | Member.findMany 42 ms (0 rows) |
| Busy trip: activity | 155 | 12 | 12587 | 106 | 49 | 514 | Group.findUnique 90 ms (12477 rows) |
| Busy trip: balances | 88 | 9 | 2105 | 169 | 0 | 193 | Group.findUnique 57 ms (1583 rows) |
| Busy trip (type trip): balances | 88 | 8 | 2097 | 168 | 0 | 191 | Group.findUnique 53 ms (1583 rows) |
| Busy trip: charts | 139 | 8 | 12287 | 96 | 43 | 194 | Group.findUnique 88 ms (12177 rows) |
| Busy trip: settle up | 39 | 13 | 715 | 106 | 0 | 88 | raw.$queryRaw 20 ms (181 rows) |
| Settle across groups | 63 | 20 | 1136 | 207 | 0 | 237 | Payment.groupBy 32 ms (21 rows) |
| Search “Expense 1” | 369 | 10 | 29159 | 247 | 122 | 432 | Group.findMany 238 ms (29114 rows) |
| Alerts | 54 | 17 | 201 | 24 | 30 | 546 | GroupEvent.findMany 4 ms (100 rows) |
| Busy trip: balances, with Undo bar | 90 | 11 | 2107 | 176 | 0 | 194 | Group.findUnique 51 ms (1583 rows) |
| Trip I left: balances | 32 | 18 | 637 | 29 | 3 | 71 | Group.findUnique 5 ms (77 rows) |
| Trip I left: activity | 63 | 21 | 580 | 24 | 39 | 504 | Group.findUnique 11 ms (410 rows) |

Server busy-ness: the slowest second held the server's single thread up by 8757.71 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1411 ms in total (7 ms each on average).
Balances still add up to zero: yes ✓.