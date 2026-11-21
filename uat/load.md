# Load test

Seeded 400 people, 120 groups, 7682 expenses, 1177 payments in 17 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 132 / 140 | 1218 / 1287 | 2791 / 2877 | 0 |
| Busy trip: activity | 201 / 203 | 1898 / 2210 | 4863 / 5014 | 0 |
| Busy trip: balances | 124 / 139 | 1158 / 1168 | 2774 / 2852 | 0 |
| Busy trip (type trip): balances | 113 / 119 | 1096 / 1119 | 2774 / 2870 | 0 |
| Busy trip: charts | 192 / 201 | 1776 / 1888 | 4483 / 4589 | 0 |
| Busy trip: settle up | 53 / 63 | 493 / 497 | 1184 / 1195 | 0 |
| Settle across groups | 80 / 83 | 747 / 750 | 1906 / 2062 | 0 |
| Search “Expense 1” | 499 / 609 | 4924 / 4939 | 12562 / 13103 | 0 |
| Alerts | 74 / 93 | 707 / 754 | 1760 / 1960 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 126 | 41 | 2780 | 680 | 0 | 133 | Member.findMany 54 ms (0 rows) |
| Busy trip: activity | 192 | 12 | 12489 | 138 | 54 | 389 | Group.findUnique 123 ms (12379 rows) |
| Busy trip: balances | 118 | 9 | 2109 | 233 | 0 | 192 | Group.findUnique 74 ms (1583 rows) |
| Busy trip (type trip): balances | 117 | 8 | 2111 | 225 | 0 | 190 | Group.findUnique 70 ms (1583 rows) |
| Busy trip: charts | 175 | 8 | 12189 | 123 | 52 | 194 | Group.findUnique 113 ms (12079 rows) |
| Busy trip: settle up | 51 | 13 | 716 | 137 | 0 | 92 | raw.$queryRaw 27 ms (144 rows) |
| Settle across groups | 80 | 20 | 1143 | 285 | 0 | 208 | Payment.groupBy 43 ms (19 rows) |
| Search “Expense 1” | 488 | 10 | 31027 | 339 | 149 | 435 | Group.findMany 328 ms (30982 rows) |
| Alerts | 70 | 17 | 215 | 37 | 33 | 546 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 121 | 11 | 2111 | 233 | 0 | 193 | Group.findUnique 75 ms (1583 rows) |
| Trip I left: balances | 39 | 18 | 613 | 42 | 0 | 72 | Group.findUnique 7 ms (77 rows) |
| Trip I left: activity | 75 | 21 | 558 | 30 | 45 | 485 | Group.findUnique 8 ms (388 rows) |

Server busy-ness: the slowest second held the server's single thread up by 4395.63 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1856 ms in total (9 ms each on average).
Balances still add up to zero: yes ✓.