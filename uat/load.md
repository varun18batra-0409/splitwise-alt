# Load test

Seeded 400 people, 120 groups, 6297 expenses, 822 payments in 9 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 76 / 82 | 647 / 678 | 1432 / 1490 | 0 |
| Busy trip: activity | 127 / 134 | 1190 / 1237 | 3145 / 3241 | 0 |
| Busy trip: balances | 132 / 133 | 1162 / 1244 | 2885 / 2961 | 0 |
| Busy trip: charts | 142 / 144 | 1152 / 1237 | 3022 / 3122 | 0 |
| Busy trip: settle up | 39 / 39 | 329 / 346 | 817 / 823 | 0 |
| Settle across groups | 46 / 134 | 397 / 408 | 984 / 1097 | 0 |
| Search “Expense 1” | 220 / 316 | 2006 / 2031 | 5143 / 5190 | 0 |
| Alerts | 51 / 115 | 456 / 474 | 1195 / 1254 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 69 | 37 | 1275 | 356 | 0 | 132 | Member.findMany 28 ms (0 rows) |
| Busy trip: activity | 132 | 15 | 99 | 93 | 39 | 347 | Group.findUnique 79 ms (1 rows) |
| Busy trip: balances | 118 | 12 | 99 | 82 | 36 | 192 | Group.findUnique 75 ms (1 rows) |
| Busy trip: charts | 123 | 12 | 99 | 80 | 43 | 194 | Group.findUnique 72 ms (1 rows) |
| Busy trip: settle up | 36 | 15 | 529 | 94 | 0 | 89 | raw.$queryRaw 18 ms (168 rows) |
| Settle across groups | 45 | 21 | 735 | 133 | 0 | 184 | Payment.groupBy 18 ms (18 rows) |
| Search “Expense 1” | 216 | 11 | 64 | 137 | 79 | 434 | Group.findMany 129 ms (21 rows) |
| Alerts | 50 | 18 | 197 | 20 | 30 | 546 | GroupEvent.findMany 3 ms (100 rows) |
| Busy trip: balances, with Undo bar | 119 | 14 | 101 | 84 | 35 | 194 | Group.findUnique 76 ms (1 rows) |
| Trip I left: balances | 27 | 20 | 153 | 17 | 10 | 72 | Group.findUnique 5 ms (1 rows) |
| Trip I left: activity | 51 | 24 | 153 | 19 | 32 | 481 | Group.findUnique 6 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2157.97 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1285 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.