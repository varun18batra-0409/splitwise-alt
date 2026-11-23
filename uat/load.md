# Load test

Seeded 400 people, 120 groups, 7724 expenses, 1252 payments in 11 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 92 / 95 | 846 / 887 | 1962 / 1980 | 0 |
| Busy trip: activity | 129 / 131 | 1168 / 1240 | 2987 / 3245 | 0 |
| Busy trip: balances | 78 / 83 | 758 / 764 | 1785 / 1803 | 0 |
| Busy trip (type trip): balances | 75 / 76 | 697 / 704 | 1825 / 1837 | 0 |
| Busy trip: charts | 139 / 146 | 1181 / 1247 | 2900 / 2939 | 0 |
| Busy trip: settle up | 37 / 44 | 331 / 338 | 845 / 871 | 0 |
| Settle across groups | 53 / 57 | 491 / 496 | 1167 / 1189 | 0 |
| Search “Expense 1” | 372 / 394 | 3263 / 3392 | 8149 / 8318 | 0 |
| Alerts | 46 / 54 | 445 / 518 | 1061 / 1094 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 83 | 41 | 2907 | 437 | 0 | 133 | Member.findMany 34 ms (0 rows) |
| Busy trip: activity | 119 | 13 | 12652 | 86 | 33 | 344 | Group.findUnique 77 ms (12542 rows) |
| Busy trip: balances | 75 | 9 | 2106 | 145 | 0 | 193 | Group.findUnique 45 ms (1583 rows) |
| Busy trip (type trip): balances | 74 | 8 | 2095 | 143 | 0 | 191 | Group.findUnique 45 ms (1583 rows) |
| Busy trip: charts | 114 | 8 | 12352 | 79 | 35 | 193 | Group.findUnique 74 ms (12242 rows) |
| Busy trip: settle up | 32 | 13 | 726 | 92 | 0 | 88 | raw.$queryRaw 17 ms (183 rows) |
| Settle across groups | 49 | 20 | 1171 | 180 | 0 | 195 | Payment.groupBy 27 ms (19 rows) |
| Search “Expense 1” | 322 | 78 | 33105 | 7688 | 0 | 437 | Expense.findMany 214 ms (1890 rows) |
| Alerts | 42 | 17 | 201 | 18 | 24 | 546 | GroupEvent.findMany 3 ms (100 rows) |
| Busy trip: balances, with Undo bar | 78 | 11 | 2109 | 152 | 0 | 194 | Group.findUnique 49 ms (1583 rows) |
| Trip I left: balances | 24 | 18 | 628 | 25 | 0 | 73 | Group.findUnique 5 ms (77 rows) |
| Trip I left: activity | 48 | 21 | 569 | 18 | 30 | 480 | Group.findUnique 5 ms (399 rows) |

Server busy-ness: the slowest second held the server's single thread up by 7189.04 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1264 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.