# Load test

Seeded 400 people, 120 groups, 6119 expenses, 848 payments in 9 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 83 / 85 | 660 / 726 | 1609 / 1633 | 0 |
| Busy trip: activity | 218 / 227 | 1673 / 1772 | 4106 / 4198 | 0 |
| Busy trip: balances | 197 / 206 | 1468 / 1475 | 3674 / 3762 | 0 |
| Busy trip: charts | 206 / 210 | 1530 / 1631 | 3811 / 3923 | 0 |
| Busy trip: settle up | 51 / 57 | 390 / 396 | 952 / 967 | 0 |
| Settle across groups | 58 / 62 | 463 / 469 | 1149 / 1265 | 0 |
| Search “Expense 1” | 322 / 348 | 2502 / 2578 | 6089 / 6285 | 0 |
| Alerts | 86 / 88 | 677 / 685 | 1654 / 1770 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 73 | 30 | 1176 | 229 | 0 | 137 | Payment.groupBy 23 ms (19 rows) |
| Busy trip: activity | 215 | 15 | 99 | 188 | 27 | 364 | Group.findUnique 142 ms (1 rows) |
| Busy trip: balances | 187 | 12 | 99 | 171 | 16 | 190 | Group.findUnique 130 ms (1 rows) |
| Busy trip: charts | 195 | 12 | 99 | 173 | 22 | 241 | Group.findUnique 135 ms (1 rows) |
| Busy trip: settle up | 46 | 15 | 538 | 116 | 0 | 91 | raw.$queryRaw 22 ms (174 rows) |
| Settle across groups | 55 | 16 | 806 | 131 | 0 | 199 | Expense.groupBy 19 ms (20 rows) |
| Search “Expense 1” | 320 | 8 | 64 | 220 | 100 | 434 | Group.findMany 213 ms (21 rows) |
| Alerts | 81 | 17 | 202 | 32 | 49 | 557 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 190 | 14 | 101 | 173 | 17 | 191 | Group.findUnique 135 ms (1 rows) |
| Trip I left: balances | 33 | 16 | 153 | 26 | 7 | 72 | Group.findUnique 8 ms (1 rows) |
| Trip I left: activity | 205 | 20 | 153 | 31 | 174 | 2010 | Group.findUnique 10 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2994.73 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2320 ms in total (12 ms each on average).
Balances still add up to zero: yes ✓.