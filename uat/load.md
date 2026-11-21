# Load test

Seeded 400 people, 120 groups, 7530 expenses, 1223 payments in 15 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 108 / 113 | 946 / 991 | 2179 / 2227 | 0 |
| Busy trip: activity | 150 / 153 | 1513 / 1617 | 3962 / 4088 | 0 |
| Busy trip: balances | 157 / 235 | 1454 / 1477 | 3578 / 3647 | 0 |
| Busy trip (type trip): balances | 148 / 202 | 1431 / 1511 | 3609 / 3638 | 0 |
| Busy trip: charts | 156 / 160 | 1450 / 1457 | 3704 / 3826 | 0 |
| Busy trip: settle up | 45 / 47 | 378 / 379 | 966 / 971 | 0 |
| Settle across groups | 63 / 65 | 573 / 670 | 1438 / 1542 | 0 |
| Search “Expense 1” | 396 / 419 | 3977 / 4022 | 10372 / 10630 | 0 |
| Alerts | 66 / 131 | 599 / 609 | 1385 / 1403 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 103 | 42 | 2616 | 561 | 0 | 133 | Member.findMany 45 ms (0 rows) |
| Busy trip: activity | 155 | 15 | 12514 | 112 | 43 | 340 | Group.findUnique 97 ms (12391 rows) |
| Busy trip: balances | 140 | 12 | 12214 | 100 | 40 | 192 | Group.findUnique 92 ms (12091 rows) |
| Busy trip (type trip): balances | 143 | 14 | 12372 | 102 | 41 | 190 | Group.findUnique 93 ms (12237 rows) |
| Busy trip: charts | 158 | 12 | 12214 | 103 | 55 | 194 | Group.findUnique 101 ms (12091 rows) |
| Busy trip: settle up | 44 | 15 | 708 | 118 | 0 | 86 | raw.$queryRaw 22 ms (177 rows) |
| Settle across groups | 65 | 21 | 1110 | 232 | 0 | 200 | Payment.groupBy 33 ms (20 rows) |
| Search “Expense 1” | 378 | 11 | 30915 | 263 | 115 | 438 | Group.findMany 253 ms (30870 rows) |
| Alerts | 54 | 18 | 205 | 24 | 30 | 546 | CollectionEntry.findMany 6 ms (0 rows) |
| Busy trip: balances, with Undo bar | 143 | 14 | 12216 | 103 | 40 | 194 | Group.findUnique 94 ms (12091 rows) |
| Trip I left: balances | 28 | 20 | 510 | 20 | 8 | 72 | Group.findUnique 7 ms (333 rows) |
| Trip I left: activity | 65 | 24 | 570 | 22 | 43 | 551 | Group.findUnique 6 ms (393 rows) |

Server busy-ness: the slowest second held the server's single thread up by 9638.51 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1703 ms in total (9 ms each on average).
Balances still add up to zero: yes ✓.