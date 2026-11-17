# Load test

Seeded 400 people, 120 groups, 5954 expenses, 889 payments in 10 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 84 / 90 | 680 / 778 | 1703 / 1752 | 0 |
| Busy trip: activity | 233 / 239 | 1865 / 1969 | 4542 / 4634 | 0 |
| Busy trip: balances | 200 / 220 | 1531 / 1546 | 3905 / 3924 | 0 |
| Busy trip: charts | 209 / 210 | 1604 / 1636 | 4012 / 4223 | 0 |
| Busy trip: settle up | 47 / 58 | 394 / 408 | 1011 / 1025 | 0 |
| Settle across groups | 59 / 63 | 488 / 494 | 1261 / 1371 | 0 |
| Search “Expense 1” | 351 / 361 | 2789 / 2834 | 6870 / 7158 | 0 |
| Alerts | 83 / 88 | 705 / 742 | 1832 / 1887 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 77 | 30 | 1234 | 238 | 0 | 136 | Payment.groupBy 22 ms (18 rows) |
| Busy trip: activity | 232 | 15 | 99 | 197 | 35 | 403 | Group.findUnique 154 ms (1 rows) |
| Busy trip: balances | 195 | 12 | 99 | 180 | 15 | 190 | Group.findUnique 137 ms (1 rows) |
| Busy trip: charts | 205 | 12 | 99 | 177 | 28 | 241 | Group.findUnique 140 ms (1 rows) |
| Busy trip: settle up | 46 | 15 | 529 | 117 | 0 | 90 | raw.$queryRaw 22 ms (169 rows) |
| Settle across groups | 57 | 16 | 808 | 137 | 0 | 192 | Payment.groupBy 20 ms (18 rows) |
| Search “Expense 1” | 351 | 8 | 64 | 244 | 107 | 435 | Group.findMany 229 ms (21 rows) |
| Alerts | 84 | 17 | 206 | 27 | 57 | 557 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 195 | 14 | 101 | 178 | 17 | 191 | Group.findUnique 139 ms (1 rows) |
| Trip I left: balances | 34 | 16 | 153 | 25 | 9 | 72 | Group.findUnique 8 ms (1 rows) |
| Trip I left: activity | 220 | 20 | 153 | 29 | 191 | 2148 | Group.findUnique 9 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 3288.33 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2188 ms in total (11 ms each on average).
Balances still add up to zero: yes ✓.