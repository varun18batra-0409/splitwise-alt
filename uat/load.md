# Load test

Seeded 400 people, 120 groups, 6255 expenses, 857 payments in 12 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 109 / 111 | 934 / 1058 | 2285 / 2356 | 0 |
| Busy trip: activity | 315 / 317 | 2451 / 2532 | 6060 / 6203 | 0 |
| Busy trip: balances | 273 / 291 | 2081 / 2086 | 5238 / 5312 | 0 |
| Busy trip: charts | 277 / 295 | 2181 / 2196 | 5378 / 5395 | 0 |
| Busy trip: settle up | 64 / 68 | 539 / 548 | 1345 / 1368 | 0 |
| Settle across groups | 79 / 80 | 674 / 683 | 1764 / 1804 | 0 |
| Search “Expense 1” | 445 / 470 | 3610 / 3716 | 9022 / 9143 | 0 |
| Alerts | 114 / 115 | 1014 / 1032 | 2538 / 2599 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 101 | 30 | 1229 | 333 | 0 | 136 | Payment.groupBy 30 ms (19 rows) |
| Busy trip: activity | 304 | 15 | 99 | 257 | 47 | 407 | Group.findUnique 195 ms (1 rows) |
| Busy trip: balances | 257 | 12 | 99 | 233 | 24 | 190 | Group.findUnique 181 ms (1 rows) |
| Busy trip: charts | 272 | 12 | 99 | 235 | 37 | 241 | Group.findUnique 177 ms (1 rows) |
| Busy trip: settle up | 61 | 15 | 537 | 155 | 0 | 91 | raw.$queryRaw 29 ms (144 rows) |
| Settle across groups | 80 | 16 | 823 | 187 | 0 | 212 | Payment.groupBy 28 ms (19 rows) |
| Search “Expense 1” | 459 | 8 | 64 | 310 | 149 | 434 | Group.findMany 297 ms (21 rows) |
| Alerts | 116 | 17 | 204 | 34 | 82 | 557 | GroupEvent.findMany 6 ms (100 rows) |
| Busy trip: balances, with Undo bar | 258 | 14 | 101 | 233 | 25 | 191 | Group.findUnique 188 ms (1 rows) |
| Trip I left: balances | 44 | 16 | 153 | 33 | 11 | 72 | Group.findUnique 10 ms (1 rows) |
| Trip I left: activity | 322 | 20 | 153 | 39 | 283 | 2211 | Group.findUnique 13 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 4336.91 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2723 ms in total (14 ms each on average).
Balances still add up to zero: yes ✓.