# Load test

Seeded 400 people, 120 groups, 6343 expenses, 915 payments in 8 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 74 / 80 | 600 / 637 | 1424 / 1488 | 0 |
| Busy trip: activity | 202 / 210 | 1531 / 1671 | 3812 / 3919 | 0 |
| Busy trip: balances | 169 / 175 | 1272 / 1300 | 3238 / 3247 | 0 |
| Busy trip: charts | 180 / 186 | 1343 / 1348 | 3268 / 3448 | 0 |
| Busy trip: settle up | 45 / 45 | 336 / 339 | 884 / 956 | 0 |
| Settle across groups | 53 / 53 | 441 / 467 | 1027 / 1036 | 0 |
| Search “Expense 1” | 296 / 309 | 2309 / 2336 | 5715 / 5836 | 0 |
| Alerts | 76 / 84 | 593 / 615 | 1445 / 1560 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 65 | 30 | 1190 | 205 | 0 | 139 | Expense.groupBy 19 ms (20 rows) |
| Busy trip: activity | 197 | 15 | 99 | 168 | 29 | 450 | Group.findUnique 128 ms (1 rows) |
| Busy trip: balances | 167 | 12 | 99 | 154 | 13 | 190 | Group.findUnique 120 ms (1 rows) |
| Busy trip: charts | 177 | 12 | 99 | 157 | 20 | 241 | Group.findUnique 120 ms (1 rows) |
| Busy trip: settle up | 40 | 15 | 534 | 106 | 0 | 90 | raw.$queryRaw 19 ms (173 rows) |
| Settle across groups | 50 | 16 | 760 | 118 | 0 | 206 | Payment.groupBy 17 ms (18 rows) |
| Search “Expense 1” | 292 | 8 | 64 | 207 | 85 | 438 | Group.findMany 210 ms (21 rows) |
| Alerts | 70 | 17 | 199 | 29 | 41 | 557 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 168 | 14 | 101 | 156 | 12 | 191 | Group.findUnique 125 ms (1 rows) |
| Trip I left: balances | 29 | 16 | 153 | 23 | 6 | 72 | Group.findUnique 8 ms (1 rows) |
| Trip I left: activity | 183 | 20 | 153 | 28 | 155 | 2047 | Group.findUnique 8 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2770.34 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2009 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.