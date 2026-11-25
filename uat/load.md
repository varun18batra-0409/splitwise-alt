# Load test

Seeded 400 people, 120 groups, 7510 expenses, 1158 payments in 11 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 99 / 105 | 881 / 941 | 2036 / 2091 | 0 |
| Busy trip: activity | 129 / 131 | 1256 / 1293 | 3091 / 3284 | 0 |
| Busy trip: balances | 89 / 90 | 748 / 778 | 1860 / 2097 | 0 |
| Busy trip (type trip): balances | 82 / 198 | 746 / 759 | 1894 / 1916 | 0 |
| Busy trip: charts | 132 / 137 | 1166 / 1243 | 2907 / 2917 | 0 |
| Busy trip: settle up | 36 / 40 | 313 / 320 | 788 / 795 | 0 |
| Settle across groups | 54 / 57 | 500 / 509 | 1249 / 1322 | 0 |
| Search “Expense 1” | 349 / 470 | 3348 / 3425 | 8439 / 8534 | 0 |
| Alerts | 46 / 53 | 429 / 439 | 1108 / 1131 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 84 | 42 | 3051 | 371 | 0 | 133 | Payment.groupBy 29 ms (20 rows) |
| Busy trip: activity | 116 | 13 | 12565 | 85 | 31 | 345 | Group.findUnique 76 ms (12455 rows) |
| Busy trip: balances | 73 | 9 | 2078 | 142 | 0 | 192 | Group.findUnique 45 ms (1583 rows) |
| Busy trip (type trip): balances | 74 | 8 | 2132 | 142 | 0 | 191 | Group.findUnique 45 ms (1583 rows) |
| Busy trip: charts | 114 | 8 | 12265 | 79 | 35 | 193 | Group.findUnique 73 ms (12155 rows) |
| Busy trip: settle up | 32 | 13 | 703 | 87 | 0 | 92 | raw.$queryRaw 16 ms (144 rows) |
| Settle across groups | 53 | 21 | 1245 | 185 | 0 | 230 | Payment.groupBy 28 ms (20 rows) |
| Search “Expense 1” | 332 | 79 | 34240 | 7878 | 0 | 433 | Expense.findMany 218 ms (1850 rows) |
| Alerts | 44 | 17 | 210 | 19 | 25 | 547 | GroupEvent.findMany 3 ms (100 rows) |
| Busy trip: balances, with Undo bar | 75 | 11 | 2080 | 148 | 0 | 194 | Group.findUnique 48 ms (1583 rows) |
| Trip I left: balances | 24 | 18 | 618 | 24 | 0 | 72 | Group.findUnique 4 ms (77 rows) |
| Trip I left: activity | 45 | 21 | 561 | 17 | 28 | 490 | Group.findUnique 5 ms (391 rows) |

Server busy-ness: the slowest second held the server's single thread up by 3154.12 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1430 ms in total (7 ms each on average).
Balances still add up to zero: yes ✓.