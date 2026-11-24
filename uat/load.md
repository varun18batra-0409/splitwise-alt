# Load test

Seeded 400 people, 120 groups, 7270 expenses, 1208 payments in 11 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 92 / 94 | 833 / 880 | 1947 / 2000 | 0 |
| Busy trip: activity | 137 / 139 | 1263 / 1359 | 3208 / 3462 | 0 |
| Busy trip: balances | 85 / 87 | 777 / 783 | 1840 / 1860 | 0 |
| Busy trip (type trip): balances | 81 / 82 | 789 / 804 | 1886 / 1930 | 0 |
| Busy trip: charts | 124 / 135 | 1130 / 1210 | 2907 / 3042 | 0 |
| Busy trip: settle up | 36 / 45 | 320 / 325 | 792 / 798 | 0 |
| Settle across groups | 57 / 58 | 503 / 508 | 1205 / 1254 | 0 |
| Search “Expense 1” | 379 / 462 | 3286 / 3375 | 7934 / 8090 | 0 |
| Alerts | 45 / 52 | 433 / 505 | 1086 / 1119 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 84 | 41 | 2929 | 441 | 0 | 133 | Member.findMany 32 ms (0 rows) |
| Busy trip: activity | 127 | 13 | 12464 | 86 | 41 | 523 | Group.findUnique 76 ms (12354 rows) |
| Busy trip: balances | 77 | 9 | 2105 | 145 | 0 | 193 | Group.findUnique 47 ms (1583 rows) |
| Busy trip (type trip): balances | 83 | 8 | 2136 | 151 | 0 | 191 | Group.findUnique 49 ms (1583 rows) |
| Busy trip: charts | 121 | 8 | 12164 | 81 | 40 | 193 | Group.findUnique 72 ms (12054 rows) |
| Busy trip: settle up | 34 | 13 | 726 | 92 | 0 | 89 | raw.$queryRaw 17 ms (184 rows) |
| Settle across groups | 54 | 20 | 1187 | 188 | 0 | 202 | Payment.groupBy 27 ms (17 rows) |
| Search “Expense 1” | 321 | 78 | 32142 | 7665 | 0 | 435 | Expense.findMany 215 ms (1877 rows) |
| Alerts | 45 | 17 | 206 | 19 | 26 | 547 | GroupEvent.findMany 3 ms (100 rows) |
| Busy trip: balances, with Undo bar | 78 | 11 | 2107 | 152 | 0 | 194 | Group.findUnique 53 ms (1583 rows) |
| Trip I left: balances | 28 | 18 | 614 | 26 | 2 | 72 | Group.findUnique 5 ms (77 rows) |
| Trip I left: activity | 52 | 21 | 555 | 19 | 33 | 492 | Group.findUnique 6 ms (385 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2950.69 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1283 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.