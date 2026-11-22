# Load test

Seeded 400 people, 120 groups, 7404 expenses, 1222 payments in 11 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 103 / 121 | 910 / 977 | 2024 / 2081 | 0 |
| Busy trip: activity | 138 / 141 | 1286 / 1347 | 3448 / 3665 | 0 |
| Busy trip: balances | 87 / 89 | 766 / 795 | 1905 / 2079 | 0 |
| Busy trip (type trip): balances | 82 / 85 | 744 / 767 | 1908 / 1949 | 0 |
| Busy trip: charts | 138 / 141 | 1274 / 1298 | 3126 / 3150 | 0 |
| Busy trip: settle up | 41 / 54 | 327 / 344 | 814 / 818 | 0 |
| Settle across groups | 58 / 61 | 519 / 537 | 1253 / 1319 | 0 |
| Search “Expense 1” | 428 / 490 | 3314 / 3330 | 8353 / 9074 | 0 |
| Alerts | 56 / 60 | 541 / 557 | 1324 / 1421 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 102 | 41 | 2786 | 537 | 0 | 133 | Member.findMany 43 ms (0 rows) |
| Busy trip: activity | 142 | 12 | 12444 | 98 | 44 | 384 | Group.findUnique 83 ms (12334 rows) |
| Busy trip: balances | 87 | 9 | 2083 | 164 | 0 | 193 | Group.findUnique 53 ms (1583 rows) |
| Busy trip (type trip): balances | 86 | 8 | 2094 | 159 | 0 | 191 | Group.findUnique 51 ms (1583 rows) |
| Busy trip: charts | 122 | 8 | 12144 | 84 | 38 | 194 | Group.findUnique 78 ms (12034 rows) |
| Busy trip: settle up | 41 | 13 | 672 | 107 | 0 | 88 | raw.$queryRaw 19 ms (144 rows) |
| Settle across groups | 61 | 20 | 1130 | 209 | 0 | 208 | Payment.groupBy 30 ms (19 rows) |
| Search “Expense 1” | 331 | 10 | 30606 | 233 | 98 | 433 | Group.findMany 221 ms (30561 rows) |
| Alerts | 54 | 17 | 202 | 23 | 31 | 546 | GroupEvent.findMany 3 ms (100 rows) |
| Busy trip: balances, with Undo bar | 93 | 11 | 2085 | 168 | 0 | 194 | Group.findUnique 68 ms (1583 rows) |
| Trip I left: balances | 32 | 18 | 633 | 33 | 0 | 71 | Group.findUnique 5 ms (77 rows) |
| Trip I left: activity | 56 | 21 | 572 | 20 | 36 | 502 | Group.findUnique 6 ms (402 rows) |

Server busy-ness: the slowest second held the server's single thread up by 7545.55 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1340 ms in total (7 ms each on average).
Balances still add up to zero: yes ✓.