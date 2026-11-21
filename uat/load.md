# Load test

Seeded 400 people, 120 groups, 7711 expenses, 1221 payments in 10 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 76 / 84 | 732 / 763 | 1559 / 1692 | 0 |
| Busy trip: activity | 121 / 124 | 1095 / 1197 | 2886 / 3128 | 0 |
| Busy trip: balances | 69 / 73 | 648 / 668 | 1578 / 1656 | 0 |
| Busy trip (type trip): balances | 69 / 94 | 617 / 627 | 1503 / 1598 | 0 |
| Busy trip: charts | 114 / 114 | 1025 / 1097 | 2634 / 2659 | 0 |
| Busy trip: settle up | 32 / 38 | 282 / 315 | 690 / 742 | 0 |
| Settle across groups | 49 / 155 | 428 / 432 | 1011 / 1050 | 0 |
| Search “Expense 1” | 340 / 361 | 3079 / 3151 | 8077 / 8558 | 0 |
| Alerts | 54 / 129 | 493 / 537 | 1109 / 1128 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 80 | 41 | 2727 | 416 | 0 | 133 | Member.findMany 35 ms (0 rows) |
| Busy trip: activity | 122 | 12 | 12576 | 87 | 35 | 385 | Group.findUnique 76 ms (12466 rows) |
| Busy trip: balances | 74 | 9 | 2117 | 139 | 0 | 192 | Group.findUnique 46 ms (1583 rows) |
| Busy trip (type trip): balances | 75 | 8 | 2089 | 134 | 0 | 190 | Group.findUnique 44 ms (1583 rows) |
| Busy trip: charts | 112 | 8 | 12276 | 78 | 34 | 194 | Group.findUnique 71 ms (12166 rows) |
| Busy trip: settle up | 34 | 13 | 717 | 89 | 0 | 88 | raw.$queryRaw 16 ms (144 rows) |
| Settle across groups | 51 | 20 | 1210 | 173 | 0 | 216 | Payment.groupBy 35 ms (20 rows) |
| Search “Expense 1” | 327 | 10 | 31047 | 231 | 96 | 438 | Group.findMany 220 ms (31002 rows) |
| Alerts | 47 | 17 | 212 | 19 | 28 | 546 | GroupEvent.findMany 3 ms (100 rows) |
| Busy trip: balances, with Undo bar | 79 | 11 | 2120 | 143 | 0 | 194 | Group.findUnique 45 ms (1583 rows) |
| Trip I left: balances | 27 | 18 | 622 | 24 | 3 | 72 | Group.findUnique 4 ms (77 rows) |
| Trip I left: activity | 50 | 21 | 565 | 19 | 31 | 497 | Group.findUnique 9 ms (395 rows) |

Server busy-ness: the slowest second held the server's single thread up by 7377.78 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1130 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.