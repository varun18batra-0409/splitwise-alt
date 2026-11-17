# Load test

Seeded 400 people, 120 groups, 6605 expenses, 907 payments in 9 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 80 / 91 | 618 / 666 | 1513 / 1527 | 0 |
| Busy trip: activity | 201 / 208 | 1469 / 1610 | 3692 / 3769 | 0 |
| Busy trip: balances | 177 / 191 | 1323 / 1329 | 3288 / 3316 | 0 |
| Busy trip: charts | 186 / 189 | 1388 / 1407 | 3353 / 3450 | 0 |
| Busy trip: settle up | 43 / 52 | 378 / 411 | 882 / 886 | 0 |
| Settle across groups | 54 / 58 | 448 / 451 | 1138 / 1203 | 0 |
| Search “Expense 1” | 304 / 327 | 2353 / 2408 | 5725 / 5750 | 0 |
| Alerts | 69 / 73 | 618 / 671 | 1440 / 1483 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 69 | 35 | 1216 | 220 | 0 | 136 | GroupEvent.findMany 18 ms (0 rows) |
| Busy trip: activity | 191 | 15 | 99 | 169 | 22 | 358 | Group.findUnique 127 ms (1 rows) |
| Busy trip: balances | 173 | 12 | 99 | 160 | 13 | 190 | Group.findUnique 123 ms (1 rows) |
| Busy trip: charts | 182 | 12 | 99 | 164 | 18 | 241 | Group.findUnique 127 ms (1 rows) |
| Busy trip: settle up | 42 | 15 | 555 | 111 | 0 | 93 | raw.$queryRaw 20 ms (193 rows) |
| Settle across groups | 55 | 21 | 793 | 133 | 0 | 235 | Payment.groupBy 17 ms (20 rows) |
| Search “Expense 1” | 296 | 11 | 64 | 215 | 81 | 431 | Group.findMany 207 ms (21 rows) |
| Alerts | 74 | 17 | 212 | 31 | 43 | 557 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 173 | 14 | 102 | 161 | 12 | 191 | Group.findUnique 124 ms (1 rows) |
| Trip I left: balances | 31 | 20 | 153 | 29 | 2 | 72 | Group.findUnique 8 ms (1 rows) |
| Trip I left: activity | 196 | 24 | 153 | 35 | 161 | 2139 | Group.findUnique 9 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2581.59 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2059 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.