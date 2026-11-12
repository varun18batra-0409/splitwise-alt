# Load test

Seeded 400 people, 120 groups, 6159 expenses, 896 payments in 6 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 69 / 76 | 548 / 621 | 1344 / 1404 | 0 |
| Busy trip: activity | 200 / 218 | 1597 / 1605 | 3868 / 3895 | 0 |
| Busy trip: balances | 173 / 174 | 1264 / 1295 | 3281 / 3358 | 0 |
| Busy trip: charts | 170 / 175 | 1282 / 1314 | 3207 / 3318 | 0 |
| Busy trip: settle up | 42 / 47 | 296 / 308 | 809 / 819 | 0 |
| Settle across groups | 56 / 57 | 428 / 456 | 1116 / 1159 | 0 |
| Search “Expense 1” | 306 / 342 | 2464 / 2584 | 6923 / 6984 | 0 |
| Alerts | 81 / 88 | 660 / 705 | 1699 / 1761 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 74 | 32 | 1146 | 228 | 0 | 143 | GroupEvent.findMany 20 ms (0 rows) |
| Busy trip: activity | 231 | 11 | 85 | 192 | 39 | 524 | Group.findUnique 146 ms (1 rows) |
| Busy trip: balances | 194 | 8 | 85 | 176 | 18 | 175 | Group.findUnique 139 ms (1 rows) |
| Busy trip: charts | 200 | 8 | 85 | 178 | 22 | 226 | Group.findUnique 140 ms (1 rows) |
| Busy trip: settle up | 46 | 16 | 503 | 121 | 0 | 94 | raw.$queryRaw 21 ms (155 rows) |
| Settle across groups | 64 | 16 | 792 | 135 | 0 | 305 | Payment.groupBy 21 ms (19 rows) |
| Search “Expense 1” | 337 | 7 | 64 | 246 | 91 | 411 | Group.findMany 237 ms (21 rows) |
| Alerts | 78 | 18 | 204 | 27 | 51 | 544 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 196 | 10 | 88 | 176 | 20 | 177 | Group.findUnique 137 ms (1 rows) |
| Trip I left: balances | 30 | 9 | 145 | 18 | 12 | 74 | Group.findUnique 14 ms (1 rows) |
| Trip I left: activity | 213 | 13 | 145 | 23 | 190 | 2267 | Group.findUnique 9 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 3500.15 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2197 ms in total (11 ms each on average).
Balances still add up to zero: yes ✓.