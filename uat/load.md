# Load test

Seeded 400 people, 120 groups, 6324 expenses, 892 payments in 7 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 71 / 75 | 525 / 624 | 1314 / 1456 | 0 |
| Busy trip: activity | 204 / 207 | 1460 / 1611 | 3731 / 3770 | 0 |
| Busy trip: balances | 164 / 175 | 1207 / 1224 | 3039 / 3116 | 0 |
| Busy trip: charts | 174 / 180 | 1265 / 1293 | 3118 / 3184 | 0 |
| Busy trip: settle up | 41 / 43 | 308 / 311 | 769 / 775 | 0 |
| Settle across groups | 66 / 71 | 546 / 641 | 1361 / 1379 | 0 |
| Search “Expense 1” | 276 / 278 | 2134 / 2161 | 5438 / 5498 | 0 |
| Alerts | 69 / 114 | 560 / 593 | 1316 / 1364 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 57 | 32 | 1143 | 190 | 0 | 151 | Payment.groupBy 16 ms (19 rows) |
| Busy trip: activity | 191 | 11 | 85 | 150 | 41 | 542 | Group.findUnique 115 ms (1 rows) |
| Busy trip: balances | 155 | 8 | 85 | 137 | 18 | 197 | Group.findUnique 104 ms (1 rows) |
| Busy trip: charts | 161 | 8 | 85 | 138 | 23 | 248 | Group.findUnique 111 ms (1 rows) |
| Busy trip: settle up | 37 | 16 | 537 | 94 | 0 | 100 | raw.$queryRaw 15 ms (187 rows) |
| Settle across groups | 63 | 16 | 795 | 100 | 0 | 506 | Payment.groupBy 16 ms (19 rows) |
| Search “Expense 1” | 274 | 7 | 64 | 189 | 85 | 454 | Group.findMany 180 ms (21 rows) |
| Alerts | 62 | 18 | 199 | 21 | 41 | 558 | GroupEvent.findMany 4 ms (100 rows) |
| Busy trip: balances, with Undo bar | 158 | 10 | 87 | 144 | 14 | 198 | Group.findUnique 120 ms (1 rows) |
| Trip I left: balances | 26 | 9 | 145 | 16 | 10 | 81 | Group.findUnique 7 ms (1 rows) |
| Trip I left: activity | 182 | 13 | 145 | 20 | 162 | 2253 | Group.findUnique 10 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2728.39 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1683 ms in total (8 ms each on average).
Balances still add up to zero: yes ✓.