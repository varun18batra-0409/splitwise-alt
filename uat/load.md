# Load test

Seeded 400 people, 120 groups, 6212 expenses, 883 payments in 12 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 110 / 122 | 920 / 1043 | 2175 / 2330 | 0 |
| Busy trip: activity | 313 / 320 | 2508 / 2608 | 6249 / 6403 | 0 |
| Busy trip: balances | 278 / 280 | 2051 / 2195 | 5104 / 5254 | 0 |
| Busy trip: charts | 270 / 274 | 2066 / 2072 | 5060 / 5293 | 0 |
| Busy trip: settle up | 62 / 74 | 546 / 555 | 1379 / 1398 | 0 |
| Settle across groups | 78 / 79 | 683 / 690 | 1754 / 1816 | 0 |
| Search “Expense 1” | 443 / 457 | 3537 / 3551 | 8714 / 8939 | 0 |
| Alerts | 111 / 113 | 1004 / 1080 | 2365 / 2503 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 95 | 32 | 1005 | 324 | 0 | 142 | Expense.findMany 26 ms (20 rows) |
| Busy trip: activity | 317 | 11 | 85 | 248 | 69 | 523 | Group.findUnique 201 ms (1 rows) |
| Busy trip: balances | 250 | 8 | 85 | 225 | 25 | 185 | Group.findUnique 176 ms (1 rows) |
| Busy trip: charts | 261 | 8 | 85 | 231 | 30 | 225 | Group.findUnique 177 ms (1 rows) |
| Busy trip: settle up | 61 | 17 | 415 | 199 | 0 | 92 | raw.$queryRaw 29 ms (48 rows) |
| Settle across groups | 81 | 17 | 656 | 194 | 0 | 242 | Expense.findMany 25 ms (20 rows) |
| Search “Expense 1” | 416 | 7 | 64 | 291 | 125 | 381 | Group.findMany 284 ms (21 rows) |
| Alerts | 108 | 18 | 206 | 41 | 67 | 544 | GroupEvent.findMany 6 ms (100 rows) |
| Busy trip: balances, with Undo bar | 249 | 10 | 87 | 226 | 23 | 187 | Group.findUnique 173 ms (1 rows) |
| Trip I left: balances | 38 | 9 | 145 | 26 | 12 | 73 | Group.findUnique 10 ms (1 rows) |
| Trip I left: activity | 332 | 13 | 145 | 30 | 302 | 2308 | Group.findUnique 12 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 4217.37 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2728 ms in total (14 ms each on average).
Balances still add up to zero: yes ✓.