# Load test

Seeded 400 people, 120 groups, 6497 expenses, 903 payments in 10 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 89 / 91 | 721 / 833 | 1710 / 1844 | 0 |
| Busy trip: activity | 249 / 265 | 1980 / 2009 | 4824 / 4871 | 0 |
| Busy trip: balances | 210 / 226 | 1596 / 1624 | 4063 / 4172 | 0 |
| Busy trip: charts | 222 / 228 | 1682 / 1716 | 4208 / 4413 | 0 |
| Busy trip: settle up | 56 / 57 | 421 / 434 | 1046 / 1054 | 0 |
| Settle across groups | 59 / 62 | 498 / 510 | 1232 / 1309 | 0 |
| Search “Expense 1” | 394 / 409 | 2970 / 3011 | 7296 / 7337 | 0 |
| Alerts | 91 / 94 | 805 / 923 | 1907 / 2018 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 81 | 30 | 1201 | 239 | 0 | 136 | GroupEvent.findMany 22 ms (0 rows) |
| Busy trip: activity | 246 | 15 | 99 | 207 | 39 | 402 | Group.findUnique 162 ms (1 rows) |
| Busy trip: balances | 208 | 12 | 99 | 189 | 19 | 190 | Group.findUnique 146 ms (1 rows) |
| Busy trip: charts | 225 | 12 | 99 | 195 | 30 | 241 | Group.findUnique 152 ms (1 rows) |
| Busy trip: settle up | 49 | 15 | 540 | 121 | 0 | 89 | raw.$queryRaw 23 ms (144 rows) |
| Settle across groups | 58 | 16 | 751 | 139 | 0 | 203 | Payment.groupBy 20 ms (19 rows) |
| Search “Expense 1” | 365 | 8 | 64 | 255 | 110 | 428 | Group.findMany 257 ms (21 rows) |
| Alerts | 83 | 17 | 206 | 32 | 51 | 557 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 206 | 14 | 102 | 188 | 18 | 191 | Group.findUnique 147 ms (1 rows) |
| Trip I left: balances | 35 | 16 | 153 | 26 | 9 | 72 | Group.findUnique 8 ms (1 rows) |
| Trip I left: activity | 206 | 20 | 153 | 32 | 174 | 1915 | Group.findUnique 9 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 3498.05 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 3666 ms in total (18 ms each on average).
Balances still add up to zero: yes ✓.