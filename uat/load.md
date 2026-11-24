# Load test

Seeded 400 people, 120 groups, 7573 expenses, 1163 payments in 17 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 132 / 135 | 1217 / 1265 | 2795 / 2866 | 0 |
| Busy trip: activity | 193 / 196 | 1858 / 2173 | 4697 / 4899 | 0 |
| Busy trip: balances | 117 / 127 | 1112 / 1156 | 2802 / 2901 | 0 |
| Busy trip (type trip): balances | 116 / 149 | 1077 / 1097 | 2712 / 2825 | 0 |
| Busy trip: charts | 201 / 213 | 1786 / 1868 | 4479 / 4704 | 0 |
| Busy trip: settle up | 50 / 60 | 466 / 481 | 1147 / 1169 | 0 |
| Settle across groups | 81 / 82 | 773 / 908 | 1907 / 2004 | 0 |
| Search “Expense 1” | 599 / 601 | 5810 / 5851 | 14665 / 14819 | 0 |
| Alerts | 74 / 75 | 649 / 696 | 1642 / 1813 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 120 | 41 | 2870 | 655 | 0 | 134 | Member.findMany 51 ms (0 rows) |
| Busy trip: activity | 185 | 13 | 12615 | 133 | 52 | 385 | Group.findUnique 118 ms (12505 rows) |
| Busy trip: balances | 112 | 9 | 2100 | 216 | 0 | 192 | Group.findUnique 70 ms (1583 rows) |
| Busy trip (type trip): balances | 113 | 8 | 2116 | 212 | 0 | 191 | Group.findUnique 67 ms (1583 rows) |
| Busy trip: charts | 176 | 8 | 12315 | 123 | 53 | 193 | Group.findUnique 113 ms (12205 rows) |
| Busy trip: settle up | 49 | 13 | 703 | 137 | 0 | 90 | raw.$queryRaw 25 ms (173 rows) |
| Settle across groups | 79 | 20 | 1193 | 284 | 0 | 231 | Payment.groupBy 41 ms (19 rows) |
| Search “Expense 1” | 582 | 77 | 32062 | 13473 | 0 | 436 | Expense.findMany 329 ms (4827 rows) |
| Alerts | 67 | 17 | 208 | 30 | 37 | 546 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 118 | 11 | 2102 | 224 | 0 | 194 | Group.findUnique 69 ms (1583 rows) |
| Trip I left: balances | 36 | 18 | 619 | 38 | 0 | 72 | Group.findUnique 7 ms (77 rows) |
| Trip I left: activity | 76 | 21 | 562 | 30 | 46 | 472 | Group.findUnique 8 ms (392 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2348.81 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1777 ms in total (9 ms each on average).
Balances still add up to zero: yes ✓.