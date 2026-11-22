# Load test

Seeded 400 people, 120 groups, 7767 expenses, 1158 payments in 11 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 88 / 89 | 763 / 815 | 1788 / 1894 | 0 |
| Busy trip: activity | 124 / 124 | 1184 / 1217 | 3064 / 3108 | 0 |
| Busy trip: balances | 76 / 80 | 748 / 802 | 1767 / 1800 | 0 |
| Busy trip (type trip): balances | 75 / 76 | 695 / 701 | 1758 / 1839 | 0 |
| Busy trip: charts | 123 / 144 | 1113 / 1190 | 2855 / 2874 | 0 |
| Busy trip: settle up | 36 / 38 | 305 / 306 | 753 / 762 | 0 |
| Settle across groups | 51 / 55 | 475 / 478 | 1188 / 1302 | 0 |
| Search “Expense 1” | 342 / 397 | 3006 / 3025 | 7571 / 7748 | 0 |
| Alerts | 47 / 52 | 439 / 449 | 1126 / 1151 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 79 | 41 | 2753 | 430 | 0 | 132 | Member.findMany 35 ms (0 rows) |
| Busy trip: activity | 120 | 12 | 12549 | 86 | 34 | 386 | Group.findUnique 75 ms (12439 rows) |
| Busy trip: balances | 76 | 9 | 2093 | 150 | 0 | 192 | Group.findUnique 48 ms (1583 rows) |
| Busy trip (type trip): balances | 76 | 8 | 2113 | 145 | 0 | 190 | Group.findUnique 47 ms (1583 rows) |
| Busy trip: charts | 113 | 8 | 12249 | 77 | 36 | 194 | Group.findUnique 70 ms (12139 rows) |
| Busy trip: settle up | 31 | 13 | 712 | 90 | 0 | 89 | raw.$queryRaw 16 ms (176 rows) |
| Settle across groups | 50 | 20 | 1167 | 174 | 0 | 237 | Payment.groupBy 26 ms (20 rows) |
| Search “Expense 1” | 310 | 10 | 31492 | 207 | 103 | 429 | Group.findMany 200 ms (31447 rows) |
| Alerts | 42 | 17 | 214 | 18 | 24 | 546 | GroupEvent.findMany 3 ms (100 rows) |
| Busy trip: balances, with Undo bar | 79 | 11 | 2095 | 153 | 0 | 194 | Group.findUnique 49 ms (1583 rows) |
| Trip I left: balances | 24 | 18 | 632 | 27 | 0 | 71 | Group.findUnique 4 ms (77 rows) |
| Trip I left: activity | 46 | 21 | 575 | 18 | 28 | 489 | Group.findUnique 5 ms (405 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2753.56 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1221 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.