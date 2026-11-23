# Load test

Seeded 400 people, 120 groups, 7418 expenses, 1220 payments in 17 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 130 / 137 | 1228 / 1274 | 2846 / 2909 | 0 |
| Busy trip: activity | 197 / 206 | 1956 / 2187 | 4854 / 4914 | 0 |
| Busy trip: balances | 124 / 126 | 1162 / 1170 | 2654 / 2800 | 0 |
| Busy trip (type trip): balances | 112 / 121 | 1069 / 1083 | 2754 / 2934 | 0 |
| Busy trip: charts | 195 / 214 | 1853 / 1960 | 4629 / 4677 | 0 |
| Busy trip: settle up | 51 / 63 | 481 / 487 | 1201 / 1209 | 0 |
| Settle across groups | 81 / 81 | 747 / 868 | 1881 / 1902 | 0 |
| Search “Expense 1” | 563 / 627 | 5305 / 5318 | 13328 / 13596 | 0 |
| Alerts | 74 / 193 | 689 / 705 | 1716 / 1749 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 133 | 41 | 2801 | 710 | 0 | 133 | Member.findMany 58 ms (0 rows) |
| Busy trip: activity | 192 | 13 | 12413 | 140 | 52 | 345 | Group.findUnique 128 ms (12303 rows) |
| Busy trip: balances | 120 | 9 | 2114 | 227 | 0 | 193 | Group.findUnique 72 ms (1583 rows) |
| Busy trip (type trip): balances | 122 | 8 | 2105 | 229 | 0 | 191 | Group.findUnique 70 ms (1583 rows) |
| Busy trip: charts | 187 | 8 | 12113 | 129 | 58 | 193 | Group.findUnique 115 ms (12003 rows) |
| Busy trip: settle up | 49 | 13 | 708 | 137 | 0 | 88 | raw.$queryRaw 26 ms (144 rows) |
| Settle across groups | 76 | 20 | 1174 | 277 | 0 | 180 | Payment.groupBy 43 ms (19 rows) |
| Search “Expense 1” | 530 | 78 | 32750 | 12577 | 0 | 434 | Expense.findMany 348 ms (1867 rows) |
| Alerts | 70 | 17 | 213 | 31 | 39 | 546 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 125 | 11 | 2117 | 236 | 0 | 194 | Group.findUnique 73 ms (1583 rows) |
| Trip I left: balances | 39 | 18 | 602 | 38 | 1 | 73 | Group.findUnique 7 ms (77 rows) |
| Trip I left: activity | 75 | 21 | 545 | 31 | 44 | 491 | Group.findUnique 8 ms (375 rows) |

Server busy-ness: the slowest second held the server's single thread up by 4798.28 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1953 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.