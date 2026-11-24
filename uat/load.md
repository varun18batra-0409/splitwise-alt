# Load test

Seeded 400 people, 120 groups, 7827 expenses, 1226 payments in 12 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 93 / 94 | 839 / 897 | 1941 / 2011 | 0 |
| Busy trip: activity | 136 / 143 | 1260 / 1314 | 3235 / 3479 | 0 |
| Busy trip: balances | 84 / 88 | 766 / 787 | 1880 / 1929 | 0 |
| Busy trip (type trip): balances | 88 / 91 | 799 / 808 | 1918 / 1963 | 0 |
| Busy trip: charts | 137 / 140 | 1261 / 1312 | 3141 / 3284 | 0 |
| Busy trip: settle up | 37 / 43 | 335 / 424 | 813 / 832 | 0 |
| Settle across groups | 60 / 61 | 521 / 526 | 1336 / 1486 | 0 |
| Search “Expense 1” | 368 / 470 | 3469 / 3518 | 8645 / 8980 | 0 |
| Alerts | 53 / 134 | 489 / 499 | 1159 / 1238 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 91 | 41 | 2852 | 462 | 0 | 133 | Member.findMany 37 ms (0 rows) |
| Busy trip: activity | 131 | 13 | 12483 | 95 | 36 | 341 | Group.findUnique 85 ms (12373 rows) |
| Busy trip: balances | 82 | 9 | 2101 | 156 | 0 | 192 | Group.findUnique 48 ms (1583 rows) |
| Busy trip (type trip): balances | 83 | 8 | 2114 | 153 | 0 | 191 | Group.findUnique 48 ms (1583 rows) |
| Busy trip: charts | 125 | 8 | 12183 | 85 | 40 | 193 | Group.findUnique 76 ms (12073 rows) |
| Busy trip: settle up | 37 | 13 | 714 | 93 | 0 | 91 | raw.$queryRaw 17 ms (178 rows) |
| Settle across groups | 61 | 20 | 1173 | 197 | 0 | 232 | Payment.groupBy 29 ms (19 rows) |
| Search “Expense 1” | 351 | 78 | 32107 | 8100 | 0 | 431 | Expense.findMany 221 ms (1751 rows) |
| Alerts | 52 | 17 | 211 | 21 | 31 | 546 | GroupEvent.findMany 3 ms (100 rows) |
| Busy trip: balances, with Undo bar | 83 | 11 | 2103 | 161 | 0 | 194 | Group.findUnique 53 ms (1583 rows) |
| Trip I left: balances | 30 | 18 | 624 | 28 | 2 | 71 | Group.findUnique 5 ms (77 rows) |
| Trip I left: activity | 53 | 21 | 569 | 19 | 34 | 488 | Group.findUnique 6 ms (399 rows) |

Server busy-ness: the slowest second held the server's single thread up by 3143.63 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1278 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.