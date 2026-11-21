# Load test

Seeded 400 people, 120 groups, 7230 expenses, 1183 payments in 16 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 128 / 135 | 1153 / 1244 | 2669 / 2750 | 0 |
| Busy trip: activity | 189 / 196 | 1959 / 2002 | 4659 / 4731 | 0 |
| Busy trip: balances | 119 / 207 | 1096 / 1149 | 2796 / 2864 | 0 |
| Busy trip (type trip): balances | 114 / 117 | 1086 / 1091 | 2698 / 2765 | 0 |
| Busy trip: charts | 195 / 201 | 1738 / 1808 | 4376 / 4520 | 0 |
| Busy trip: settle up | 49 / 60 | 490 / 559 | 1138 / 1192 | 0 |
| Settle across groups | 79 / 81 | 719 / 721 | 1858 / 1878 | 0 |
| Search “Expense 1” | 458 / 475 | 4570 / 4750 | 11494 / 11545 | 0 |
| Alerts | 73 / 84 | 662 / 709 | 1631 / 1820 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 119 | 41 | 2680 | 654 | 0 | 133 | Member.findMany 50 ms (0 rows) |
| Busy trip: activity | 185 | 12 | 12471 | 136 | 49 | 343 | Group.findUnique 118 ms (12361 rows) |
| Busy trip: balances | 116 | 9 | 2128 | 225 | 0 | 192 | Group.findUnique 76 ms (1583 rows) |
| Busy trip (type trip): balances | 118 | 8 | 2110 | 222 | 0 | 190 | Group.findUnique 72 ms (1583 rows) |
| Busy trip: charts | 175 | 8 | 12171 | 122 | 53 | 194 | Group.findUnique 111 ms (12061 rows) |
| Busy trip: settle up | 50 | 13 | 712 | 136 | 0 | 86 | raw.$queryRaw 26 ms (178 rows) |
| Settle across groups | 78 | 20 | 1153 | 281 | 0 | 195 | Payment.groupBy 42 ms (21 rows) |
| Search “Expense 1” | 466 | 10 | 29664 | 315 | 151 | 435 | Group.findMany 300 ms (29619 rows) |
| Alerts | 65 | 17 | 205 | 30 | 35 | 546 | GroupEvent.findMany 4 ms (100 rows) |
| Busy trip: balances, with Undo bar | 119 | 11 | 2130 | 227 | 0 | 194 | Group.findUnique 73 ms (1583 rows) |
| Trip I left: balances | 37 | 18 | 608 | 41 | 0 | 71 | Group.findUnique 7 ms (77 rows) |
| Trip I left: activity | 71 | 21 | 551 | 33 | 38 | 467 | Group.findUnique 8 ms (381 rows) |

Server busy-ness: the slowest second held the server's single thread up by 4139.78 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1694 ms in total (8 ms each on average).
Balances still add up to zero: yes ✓.