# Load test

Seeded 400 people, 120 groups, 6536 expenses, 851 payments in 9 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 84 / 85 | 697 / 754 | 1718 / 1824 | 0 |
| Busy trip: activity | 238 / 271 | 1840 / 1940 | 4601 / 4628 | 0 |
| Busy trip: balances | 196 / 210 | 1537 / 1614 | 3857 / 4028 | 0 |
| Busy trip: charts | 204 / 207 | 1592 / 1667 | 3879 / 4038 | 0 |
| Busy trip: settle up | 49 / 55 | 398 / 412 | 1017 / 1025 | 0 |
| Settle across groups | 59 / 61 | 505 / 509 | 1304 / 1365 | 0 |
| Search “Expense 1” | 374 / 379 | 2908 / 2954 | 7295 / 7415 | 0 |
| Alerts | 90 / 92 | 738 / 762 | 1775 / 1909 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 77 | 32 | 1125 | 263 | 0 | 149 | GroupEvent.findMany 22 ms (0 rows) |
| Busy trip: activity | 234 | 11 | 85 | 196 | 38 | 481 | Group.findUnique 153 ms (1 rows) |
| Busy trip: balances | 207 | 8 | 85 | 181 | 26 | 175 | Group.findUnique 144 ms (1 rows) |
| Busy trip: charts | 204 | 8 | 85 | 181 | 23 | 226 | Group.findUnique 146 ms (1 rows) |
| Busy trip: settle up | 47 | 16 | 518 | 127 | 0 | 92 | raw.$queryRaw 22 ms (144 rows) |
| Settle across groups | 61 | 16 | 750 | 152 | 0 | 227 | Payment.groupBy 24 ms (17 rows) |
| Search “Expense 1” | 366 | 7 | 64 | 262 | 104 | 417 | Group.findMany 268 ms (21 rows) |
| Alerts | 84 | 18 | 202 | 33 | 51 | 544 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 206 | 10 | 88 | 188 | 18 | 177 | Group.findUnique 145 ms (1 rows) |
| Trip I left: balances | 31 | 9 | 145 | 19 | 12 | 74 | Group.findUnique 8 ms (1 rows) |
| Trip I left: activity | 197 | 13 | 145 | 23 | 174 | 1917 | Group.findUnique 9 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 3651.14 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2263 ms in total (11 ms each on average).
Balances still add up to zero: yes ✓.