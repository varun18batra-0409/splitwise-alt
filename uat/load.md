# Load test

Seeded 400 people, 120 groups, 7636 expenses, 1210 payments in 12 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 95 / 95 | 855 / 913 | 1978 / 2020 | 0 |
| Busy trip: activity | 140 / 141 | 1307 / 1369 | 3438 / 3653 | 0 |
| Busy trip: balances | 85 / 87 | 787 / 798 | 1962 / 1990 | 0 |
| Busy trip (type trip): balances | 88 / 89 | 777 / 790 | 1860 / 1943 | 0 |
| Busy trip: charts | 136 / 136 | 1208 / 1306 | 3031 / 3120 | 0 |
| Busy trip: settle up | 37 / 43 | 336 / 340 | 829 / 835 | 0 |
| Settle across groups | 58 / 61 | 557 / 603 | 1300 / 1371 | 0 |
| Search “Expense 1” | 353 / 377 | 3323 / 3354 | 8331 / 8414 | 0 |
| Alerts | 54 / 157 | 516 / 605 | 1221 / 1245 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 94 | 41 | 2748 | 493 | 0 | 133 | Member.findMany 39 ms (0 rows) |
| Busy trip: activity | 134 | 12 | 12453 | 96 | 38 | 387 | Group.findUnique 81 ms (12343 rows) |
| Busy trip: balances | 85 | 9 | 2118 | 165 | 0 | 192 | Group.findUnique 53 ms (1583 rows) |
| Busy trip (type trip): balances | 85 | 8 | 2105 | 160 | 0 | 190 | Group.findUnique 53 ms (1583 rows) |
| Busy trip: charts | 124 | 8 | 12153 | 86 | 38 | 194 | Group.findUnique 81 ms (12043 rows) |
| Busy trip: settle up | 36 | 13 | 735 | 96 | 0 | 92 | raw.$queryRaw 18 ms (144 rows) |
| Settle across groups | 59 | 20 | 1147 | 192 | 0 | 230 | Payment.groupBy 28 ms (19 rows) |
| Search “Expense 1” | 320 | 10 | 30524 | 220 | 100 | 436 | Group.findMany 212 ms (30479 rows) |
| Alerts | 51 | 17 | 210 | 21 | 30 | 546 | GroupEvent.findMany 3 ms (100 rows) |
| Busy trip: balances, with Undo bar | 88 | 11 | 2121 | 168 | 0 | 194 | Group.findUnique 53 ms (1583 rows) |
| Trip I left: balances | 30 | 18 | 618 | 30 | 0 | 72 | Group.findUnique 5 ms (77 rows) |
| Trip I left: activity | 53 | 21 | 557 | 20 | 33 | 504 | Group.findUnique 11 ms (387 rows) |

Server busy-ness: the slowest second held the server's single thread up by 3089.1 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1284 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.