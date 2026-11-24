# Load test

Seeded 400 people, 120 groups, 7705 expenses, 1156 payments in 13 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 102 / 107 | 916 / 970 | 2081 / 2138 | 0 |
| Busy trip: activity | 149 / 151 | 1411 / 1464 | 3763 / 3823 | 0 |
| Busy trip: balances | 89 / 93 | 840 / 850 | 2054 / 2158 | 0 |
| Busy trip (type trip): balances | 95 / 98 | 829 / 867 | 2011 / 2048 | 0 |
| Busy trip: charts | 141 / 153 | 1365 / 1412 | 3453 / 3525 | 0 |
| Busy trip: settle up | 50 / 52 | 351 / 369 | 893 / 925 | 0 |
| Settle across groups | 65 / 65 | 582 / 711 | 1408 / 1491 | 0 |
| Search “Expense 1” | 427 / 442 | 3990 / 4035 | 10172 / 10753 | 0 |
| Alerts | 55 / 57 | 543 / 567 | 1315 / 1387 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 98 | 41 | 2778 | 501 | 0 | 133 | Member.findMany 40 ms (0 rows) |
| Busy trip: activity | 141 | 13 | 12452 | 102 | 39 | 386 | Group.findUnique 89 ms (12342 rows) |
| Busy trip: balances | 85 | 9 | 2099 | 160 | 0 | 192 | Group.findUnique 50 ms (1583 rows) |
| Busy trip (type trip): balances | 86 | 8 | 2091 | 163 | 0 | 191 | Group.findUnique 50 ms (1583 rows) |
| Busy trip: charts | 134 | 8 | 12152 | 92 | 42 | 193 | Group.findUnique 83 ms (12042 rows) |
| Busy trip: settle up | 37 | 13 | 724 | 103 | 0 | 90 | Expense.findMany 19 ms (194 rows) |
| Settle across groups | 61 | 20 | 1190 | 221 | 0 | 244 | Payment.groupBy 30 ms (20 rows) |
| Search “Expense 1” | 398 | 78 | 33102 | 9116 | 0 | 431 | Expense.findMany 252 ms (1839 rows) |
| Alerts | 51 | 17 | 215 | 23 | 28 | 546 | GroupEvent.findMany 4 ms (100 rows) |
| Busy trip: balances, with Undo bar | 91 | 11 | 2101 | 169 | 0 | 194 | Group.findUnique 54 ms (1583 rows) |
| Trip I left: balances | 29 | 18 | 617 | 29 | 0 | 72 | Group.findUnique 5 ms (77 rows) |
| Trip I left: activity | 58 | 21 | 560 | 21 | 37 | 489 | Group.findUnique 6 ms (390 rows) |

Server busy-ness: the slowest second held the server's single thread up by 3678.4 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1483 ms in total (7 ms each on average).
Balances still add up to zero: yes ✓.