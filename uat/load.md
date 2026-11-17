# Load test

Seeded 400 people, 120 groups, 6599 expenses, 947 payments in 9 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 85 / 85 | 654 / 698 | 1551 / 1637 | 0 |
| Busy trip: activity | 224 / 225 | 1629 / 1776 | 4154 / 4212 | 0 |
| Busy trip: balances | 187 / 206 | 1426 / 1430 | 3555 / 3586 | 0 |
| Busy trip: charts | 208 / 213 | 1480 / 1489 | 3675 / 3763 | 0 |
| Busy trip: settle up | 49 / 55 | 379 / 399 | 939 / 948 | 0 |
| Settle across groups | 56 / 59 | 455 / 459 | 1109 / 1248 | 0 |
| Search “Expense 1” | 345 / 373 | 2592 / 2667 | 6271 / 6303 | 0 |
| Alerts | 80 / 85 | 699 / 810 | 1658 / 1706 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 77 | 30 | 1246 | 224 | 0 | 136 | GroupEvent.findMany 21 ms (0 rows) |
| Busy trip: activity | 229 | 15 | 99 | 195 | 34 | 405 | Group.findUnique 146 ms (1 rows) |
| Busy trip: balances | 194 | 12 | 99 | 177 | 17 | 190 | Group.findUnique 141 ms (1 rows) |
| Busy trip: charts | 205 | 12 | 99 | 175 | 30 | 241 | Group.findUnique 134 ms (1 rows) |
| Busy trip: settle up | 48 | 15 | 535 | 116 | 0 | 91 | raw.$queryRaw 20 ms (175 rows) |
| Settle across groups | 57 | 16 | 813 | 140 | 0 | 192 | GroupEvent.findMany 19 ms (0 rows) |
| Search “Expense 1” | 322 | 8 | 64 | 229 | 93 | 435 | Group.findMany 219 ms (21 rows) |
| Alerts | 78 | 17 | 204 | 28 | 50 | 557 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 187 | 14 | 101 | 171 | 16 | 191 | Group.findUnique 131 ms (1 rows) |
| Trip I left: balances | 35 | 16 | 153 | 26 | 9 | 72 | Group.findUnique 8 ms (1 rows) |
| Trip I left: activity | 176 | 20 | 153 | 31 | 145 | 1747 | Group.findUnique 10 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 3019.9 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2126 ms in total (11 ms each on average).
Balances still add up to zero: yes ✓.