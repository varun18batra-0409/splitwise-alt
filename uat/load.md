# Load test

Seeded 400 people, 120 groups, 7440 expenses, 1184 payments in 11 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 94 / 100 | 846 / 905 | 1930 / 2018 | 0 |
| Busy trip: activity | 130 / 137 | 1279 / 1289 | 3327 / 3396 | 0 |
| Busy trip: balances | 82 / 86 | 764 / 768 | 1875 / 1926 | 0 |
| Busy trip (type trip): balances | 90 / 92 | 773 / 803 | 1879 / 1905 | 0 |
| Busy trip: charts | 128 / 131 | 1246 / 1288 | 3118 / 3162 | 0 |
| Busy trip: settle up | 38 / 43 | 328 / 347 | 798 / 815 | 0 |
| Settle across groups | 59 / 59 | 516 / 522 | 1272 / 1359 | 0 |
| Search “Expense 1” | 374 / 474 | 3388 / 3404 | 8506 / 9044 | 0 |
| Alerts | 51 / 58 | 470 / 503 | 1169 / 1257 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 90 | 41 | 2901 | 447 | 0 | 133 | Member.findMany 36 ms (0 rows) |
| Busy trip: activity | 132 | 13 | 12416 | 93 | 39 | 386 | Group.findUnique 83 ms (12306 rows) |
| Busy trip: balances | 80 | 9 | 2097 | 153 | 0 | 192 | Group.findUnique 50 ms (1583 rows) |
| Busy trip (type trip): balances | 80 | 8 | 2090 | 151 | 0 | 191 | Group.findUnique 50 ms (1583 rows) |
| Busy trip: charts | 123 | 8 | 12116 | 84 | 39 | 193 | Group.findUnique 77 ms (12006 rows) |
| Busy trip: settle up | 36 | 13 | 708 | 91 | 0 | 89 | raw.$queryRaw 17 ms (144 rows) |
| Settle across groups | 57 | 20 | 1257 | 187 | 0 | 234 | Payment.groupBy 27 ms (19 rows) |
| Search “Expense 1” | 343 | 78 | 32928 | 8113 | 0 | 431 | Expense.findMany 225 ms (1764 rows) |
| Alerts | 53 | 17 | 211 | 22 | 31 | 547 | GroupEvent.findMany 3 ms (100 rows) |
| Busy trip: balances, with Undo bar | 85 | 11 | 2099 | 160 | 0 | 194 | Group.findUnique 51 ms (1583 rows) |
| Trip I left: balances | 29 | 18 | 619 | 27 | 2 | 72 | Group.findUnique 5 ms (77 rows) |
| Trip I left: activity | 54 | 21 | 562 | 20 | 34 | 491 | Group.findUnique 6 ms (392 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2996.83 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1274 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.