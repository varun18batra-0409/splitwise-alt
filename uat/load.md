# Load test

Seeded 400 people, 120 groups, 5957 expenses, 863 payments in 11 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 111 / 118 | 934 / 1034 | 2243 / 2340 | 0 |
| Busy trip: activity | 294 / 306 | 2367 / 2374 | 5855 / 5928 | 0 |
| Busy trip: balances | 256 / 265 | 2055 / 2067 | 5020 / 5268 | 0 |
| Busy trip: charts | 266 / 270 | 2068 / 2262 | 5098 / 5309 | 0 |
| Busy trip: settle up | 65 / 69 | 536 / 540 | 1332 / 1341 | 0 |
| Settle across groups | 80 / 81 | 692 / 704 | 1736 / 1803 | 0 |
| Search “Expense 1” | 434 / 437 | 3540 / 3600 | 8777 / 8896 | 0 |
| Alerts | 111 / 125 | 1011 / 1080 | 2361 / 2507 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 95 | 30 | 1237 | 305 | 0 | 136 | Payment.groupBy 28 ms (20 rows) |
| Busy trip: activity | 281 | 15 | 99 | 245 | 36 | 349 | Group.findUnique 188 ms (1 rows) |
| Busy trip: balances | 251 | 12 | 99 | 227 | 24 | 190 | Group.findUnique 173 ms (1 rows) |
| Busy trip: charts | 256 | 12 | 99 | 232 | 24 | 203 | Group.findUnique 172 ms (1 rows) |
| Busy trip: settle up | 63 | 15 | 541 | 159 | 0 | 95 | raw.$queryRaw 31 ms (184 rows) |
| Settle across groups | 80 | 16 | 803 | 183 | 0 | 231 | Payment.groupBy 27 ms (20 rows) |
| Search “Expense 1” | 430 | 8 | 64 | 297 | 133 | 436 | Group.findMany 288 ms (21 rows) |
| Alerts | 107 | 17 | 216 | 33 | 74 | 558 | GroupEvent.findMany 6 ms (100 rows) |
| Busy trip: balances, with Undo bar | 248 | 14 | 101 | 229 | 19 | 192 | Group.findUnique 180 ms (1 rows) |
| Trip I left: balances | 41 | 16 | 153 | 32 | 9 | 73 | Group.findUnique 10 ms (1 rows) |
| Trip I left: activity | 300 | 20 | 153 | 38 | 262 | 2126 | Group.findUnique 12 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 4274 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2585 ms in total (13 ms each on average).
Balances still add up to zero: yes ✓.