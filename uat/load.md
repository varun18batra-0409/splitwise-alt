# Load test

Seeded 400 people, 120 groups, 6054 expenses, 771 payments in 9 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 70 / 76 | 616 / 645 | 1368 / 1440 | 0 |
| Busy trip: activity | 129 / 137 | 1210 / 1246 | 3076 / 3126 | 0 |
| Busy trip: balances | 126 / 130 | 1091 / 1106 | 2824 / 3068 | 0 |
| Busy trip: charts | 122 / 124 | 1171 / 1203 | 2953 / 2992 | 0 |
| Busy trip: settle up | 56 / 81 | 331 / 339 | 816 / 834 | 0 |
| Settle across groups | 44 / 48 | 407 / 409 | 1045 / 1083 | 0 |
| Search “Expense 1” | 203 / 224 | 1947 / 1953 | 4804 / 4841 | 0 |
| Alerts | 50 / 58 | 467 / 486 | 1120 / 1154 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 65 | 37 | 1231 | 316 | 0 | 134 | Member.findMany 26 ms (0 rows) |
| Busy trip: activity | 130 | 15 | 99 | 90 | 40 | 388 | Group.findUnique 84 ms (1 rows) |
| Busy trip: balances | 127 | 12 | 99 | 83 | 44 | 192 | Group.findUnique 81 ms (1 rows) |
| Busy trip: charts | 128 | 12 | 99 | 82 | 46 | 194 | Group.findUnique 74 ms (1 rows) |
| Busy trip: settle up | 39 | 15 | 537 | 98 | 0 | 87 | raw.$queryRaw 19 ms (144 rows) |
| Settle across groups | 48 | 21 | 732 | 140 | 0 | 201 | Payment.groupBy 19 ms (18 rows) |
| Search “Expense 1” | 198 | 11 | 64 | 127 | 71 | 431 | Group.findMany 118 ms (21 rows) |
| Alerts | 45 | 18 | 208 | 21 | 24 | 546 | GroupEvent.findMany 3 ms (100 rows) |
| Busy trip: balances, with Undo bar | 121 | 14 | 102 | 82 | 39 | 193 | Group.findUnique 73 ms (1 rows) |
| Trip I left: balances | 27 | 20 | 153 | 19 | 8 | 72 | Group.findUnique 5 ms (1 rows) |
| Trip I left: activity | 52 | 24 | 153 | 21 | 31 | 495 | Group.findUnique 6 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 1600.13 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1257 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.