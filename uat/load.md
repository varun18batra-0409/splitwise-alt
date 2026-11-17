# Load test

Seeded 400 people, 120 groups, 6426 expenses, 942 payments in 9 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 78 / 84 | 656 / 684 | 1546 / 1648 | 0 |
| Busy trip: activity | 217 / 225 | 1622 / 1734 | 3999 / 4065 | 0 |
| Busy trip: balances | 186 / 196 | 1380 / 1437 | 3318 / 3467 | 0 |
| Busy trip: charts | 196 / 197 | 1420 / 1491 | 3485 / 3567 | 0 |
| Busy trip: settle up | 45 / 49 | 368 / 372 | 910 / 923 | 0 |
| Settle across groups | 54 / 57 | 443 / 448 | 1142 / 1233 | 0 |
| Search “Expense 1” | 318 / 335 | 2425 / 2518 | 6082 / 6326 | 0 |
| Alerts | 79 / 82 | 653 / 661 | 1612 / 1686 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 77 | 30 | 1295 | 236 | 0 | 136 | GroupEvent.findMany 23 ms (0 rows) |
| Busy trip: activity | 221 | 15 | 99 | 187 | 34 | 407 | Group.findUnique 141 ms (1 rows) |
| Busy trip: balances | 187 | 12 | 99 | 171 | 16 | 190 | Group.findUnique 131 ms (1 rows) |
| Busy trip: charts | 193 | 12 | 99 | 170 | 23 | 241 | Group.findUnique 130 ms (1 rows) |
| Busy trip: settle up | 47 | 15 | 540 | 115 | 0 | 89 | raw.$queryRaw 23 ms (144 rows) |
| Settle across groups | 58 | 16 | 860 | 138 | 0 | 198 | Payment.groupBy 22 ms (19 rows) |
| Search “Expense 1” | 321 | 8 | 64 | 230 | 91 | 432 | Group.findMany 219 ms (21 rows) |
| Alerts | 80 | 17 | 205 | 34 | 46 | 557 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 181 | 14 | 101 | 168 | 13 | 191 | Group.findUnique 130 ms (1 rows) |
| Trip I left: balances | 35 | 16 | 153 | 26 | 9 | 72 | Group.findUnique 8 ms (1 rows) |
| Trip I left: activity | 212 | 20 | 153 | 30 | 182 | 2280 | Group.findUnique 9 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2738.88 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2061 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.