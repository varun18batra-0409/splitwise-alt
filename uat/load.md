# Load test

Seeded 400 people, 120 groups, 7483 expenses, 1215 payments in 11 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 99 / 102 | 867 / 913 | 2049 / 2120 | 0 |
| Busy trip: activity | 138 / 148 | 1258 / 1371 | 3257 / 3380 | 0 |
| Busy trip: balances | 91 / 93 | 825 / 828 | 1924 / 1935 | 0 |
| Busy trip (type trip): balances | 83 / 85 | 815 / 877 | 1944 / 1974 | 0 |
| Busy trip: charts | 142 / 222 | 1200 / 1333 | 3109 / 3137 | 0 |
| Busy trip: settle up | 44 / 132 | 363 / 376 | 831 / 857 | 0 |
| Settle across groups | 60 / 68 | 525 / 532 | 1251 / 1266 | 0 |
| Search “Expense 1” | 399 / 479 | 3923 / 4030 | 9645 / 10064 | 0 |
| Alerts | 51 / 60 | 513 / 558 | 1213 / 1275 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 91 | 41 | 2907 | 469 | 0 | 133 | Member.findMany 36 ms (0 rows) |
| Busy trip: activity | 130 | 13 | 12494 | 92 | 38 | 343 | Group.findUnique 82 ms (12384 rows) |
| Busy trip: balances | 84 | 9 | 2105 | 161 | 0 | 193 | Group.findUnique 51 ms (1583 rows) |
| Busy trip (type trip): balances | 83 | 8 | 2085 | 160 | 0 | 191 | Group.findUnique 52 ms (1583 rows) |
| Busy trip: charts | 125 | 8 | 12194 | 85 | 40 | 193 | Group.findUnique 78 ms (12084 rows) |
| Busy trip: settle up | 37 | 13 | 720 | 97 | 0 | 90 | raw.$queryRaw 18 ms (144 rows) |
| Settle across groups | 60 | 20 | 1188 | 203 | 0 | 243 | Payment.groupBy 30 ms (21 rows) |
| Search “Expense 1” | 389 | 77 | 29820 | 8657 | 0 | 437 | Expense.findMany 213 ms (1936 rows) |
| Alerts | 52 | 17 | 219 | 22 | 30 | 547 | GroupEvent.findMany 3 ms (100 rows) |
| Busy trip: balances, with Undo bar | 88 | 11 | 2107 | 170 | 0 | 194 | Group.findUnique 53 ms (1583 rows) |
| Trip I left: balances | 30 | 18 | 621 | 29 | 1 | 72 | Group.findUnique 5 ms (77 rows) |
| Trip I left: activity | 53 | 21 | 564 | 20 | 33 | 453 | Group.findUnique 6 ms (394 rows) |

Server busy-ness: the slowest second held the server's single thread up by 3598.71 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1331 ms in total (7 ms each on average).
Balances still add up to zero: yes ✓.