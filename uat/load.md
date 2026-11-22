# Load test

Seeded 400 people, 120 groups, 7343 expenses, 1155 payments in 11 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 89 / 96 | 799 / 846 | 1776 / 1867 | 0 |
| Busy trip: activity | 128 / 129 | 1236 / 1302 | 3167 / 3341 | 0 |
| Busy trip: balances | 83 / 96 | 790 / 828 | 1832 / 1887 | 0 |
| Busy trip (type trip): balances | 79 / 79 | 726 / 775 | 1832 / 1862 | 0 |
| Busy trip: charts | 130 / 132 | 1176 / 1237 | 3041 / 3058 | 0 |
| Busy trip: settle up | 42 / 45 | 333 / 339 | 838 / 899 | 0 |
| Settle across groups | 62 / 171 | 530 / 537 | 1238 / 1250 | 0 |
| Search “Expense 1” | 329 / 363 | 3139 / 3192 | 7852 / 7911 | 0 |
| Alerts | 51 / 58 | 473 / 541 | 1186 / 1206 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 87 | 41 | 2662 | 464 | 0 | 133 | Member.findMany 43 ms (0 rows) |
| Busy trip: activity | 132 | 12 | 12588 | 93 | 39 | 388 | Group.findUnique 105 ms (12478 rows) |
| Busy trip: balances | 85 | 9 | 2107 | 161 | 0 | 192 | Group.findUnique 52 ms (1583 rows) |
| Busy trip (type trip): balances | 83 | 8 | 2114 | 159 | 0 | 191 | Group.findUnique 51 ms (1583 rows) |
| Busy trip: charts | 126 | 8 | 12288 | 86 | 40 | 194 | Group.findUnique 79 ms (12178 rows) |
| Busy trip: settle up | 38 | 13 | 693 | 95 | 0 | 88 | raw.$queryRaw 18 ms (144 rows) |
| Settle across groups | 55 | 20 | 1112 | 189 | 0 | 202 | Payment.groupBy 28 ms (18 rows) |
| Search “Expense 1” | 316 | 10 | 29703 | 221 | 95 | 438 | Group.findMany 212 ms (29658 rows) |
| Alerts | 50 | 17 | 208 | 21 | 29 | 546 | GroupEvent.findMany 3 ms (100 rows) |
| Busy trip: balances, with Undo bar | 88 | 11 | 2110 | 167 | 0 | 194 | Group.findUnique 51 ms (1583 rows) |
| Trip I left: balances | 30 | 18 | 627 | 29 | 1 | 71 | Group.findUnique 5 ms (77 rows) |
| Trip I left: activity | 57 | 21 | 570 | 24 | 33 | 519 | Group.findUnique 11 ms (400 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2524.97 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1298 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.