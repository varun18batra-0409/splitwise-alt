# Load test

Seeded 400 people, 120 groups, 7726 expenses, 1167 payments in 17 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 139 / 145 | 1318 / 1376 | 2997 / 3148 | 0 |
| Busy trip: activity | 219 / 315 | 1895 / 2209 | 4954 / 5031 | 0 |
| Busy trip: balances | 134 / 150 | 1186 / 1218 | 2910 / 2967 | 0 |
| Busy trip (type trip): balances | 117 / 134 | 1122 / 1140 | 2873 / 2962 | 0 |
| Busy trip: charts | 199 / 206 | 1852 / 1924 | 4583 / 4687 | 0 |
| Busy trip: settle up | 59 / 62 | 489 / 532 | 1250 / 1380 | 0 |
| Settle across groups | 84 / 88 | 781 / 893 | 1842 / 1882 | 0 |
| Search “Expense 1” | 590 / 667 | 5558 / 5605 | 14025 / 14177 | 0 |
| Alerts | 83 / 146 | 687 / 752 | 1754 / 1814 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 132 | 41 | 3013 | 728 | 0 | 133 | Member.findMany 54 ms (0 rows) |
| Busy trip: activity | 194 | 13 | 12509 | 139 | 55 | 389 | Group.findUnique 123 ms (12399 rows) |
| Busy trip: balances | 116 | 9 | 2098 | 227 | 0 | 192 | Group.findUnique 73 ms (1583 rows) |
| Busy trip (type trip): balances | 119 | 8 | 2119 | 229 | 0 | 191 | Group.findUnique 74 ms (1583 rows) |
| Busy trip: charts | 184 | 8 | 12209 | 127 | 57 | 193 | Group.findUnique 117 ms (12099 rows) |
| Busy trip: settle up | 49 | 13 | 708 | 140 | 0 | 89 | raw.$queryRaw 26 ms (175 rows) |
| Settle across groups | 81 | 20 | 1132 | 295 | 0 | 182 | Payment.groupBy 43 ms (20 rows) |
| Search “Expense 1” | 554 | 78 | 34376 | 13394 | 0 | 432 | Expense.findMany 381 ms (1754 rows) |
| Alerts | 71 | 17 | 207 | 31 | 40 | 546 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 125 | 11 | 2100 | 238 | 0 | 194 | Group.findUnique 71 ms (1583 rows) |
| Trip I left: balances | 38 | 18 | 615 | 39 | 0 | 72 | Group.findUnique 7 ms (77 rows) |
| Trip I left: activity | 77 | 21 | 556 | 30 | 47 | 473 | Group.findUnique 8 ms (386 rows) |

Server busy-ness: the slowest second held the server's single thread up by 5104.47 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1920 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.