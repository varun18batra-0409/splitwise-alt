# Load test

Seeded 400 people, 120 groups, 5800 expenses, 930 payments in 11 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 109 / 126 | 919 / 1037 | 2208 / 2294 | 0 |
| Busy trip: activity | 321 / 330 | 2492 / 2534 | 6163 / 6241 | 0 |
| Busy trip: balances | 269 / 278 | 2120 / 2211 | 5210 / 5382 | 0 |
| Busy trip: charts | 288 / 307 | 2241 / 2299 | 5489 / 5545 | 0 |
| Busy trip: settle up | 66 / 70 | 554 / 592 | 1404 / 1412 | 0 |
| Settle across groups | 84 / 86 | 727 / 752 | 1883 / 2007 | 0 |
| Search “Expense 1” | 468 / 479 | 3640 / 3720 | 8798 / 8893 | 0 |
| Alerts | 120 / 149 | 1032 / 1041 | 2619 / 2674 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 106 | 30 | 1132 | 325 | 0 | 136 | GroupEvent.findMany 29 ms (0 rows) |
| Busy trip: activity | 327 | 15 | 99 | 276 | 51 | 404 | Group.findUnique 209 ms (1 rows) |
| Busy trip: balances | 276 | 12 | 99 | 253 | 23 | 189 | Group.findUnique 193 ms (1 rows) |
| Busy trip: charts | 291 | 12 | 99 | 246 | 45 | 241 | Group.findUnique 191 ms (1 rows) |
| Busy trip: settle up | 67 | 15 | 538 | 174 | 0 | 93 | raw.$queryRaw 33 ms (144 rows) |
| Settle across groups | 84 | 16 | 743 | 186 | 0 | 247 | Payment.groupBy 27 ms (18 rows) |
| Search “Expense 1” | 458 | 8 | 64 | 308 | 150 | 429 | Group.findMany 298 ms (21 rows) |
| Alerts | 120 | 17 | 212 | 43 | 77 | 557 | GroupEvent.findMany 7 ms (100 rows) |
| Busy trip: balances, with Undo bar | 270 | 14 | 101 | 245 | 25 | 191 | Group.findUnique 190 ms (1 rows) |
| Trip I left: balances | 48 | 16 | 153 | 35 | 13 | 72 | Group.findUnique 11 ms (1 rows) |
| Trip I left: activity | 296 | 20 | 153 | 45 | 251 | 1973 | Group.findUnique 13 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 4148.17 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2998 ms in total (15 ms each on average).
Balances still add up to zero: yes ✓.