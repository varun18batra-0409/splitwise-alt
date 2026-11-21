# Load test

Seeded 400 people, 120 groups, 7769 expenses, 1204 payments in 15 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 125 / 126 | 1010 / 1093 | 2276 / 2375 | 0 |
| Busy trip: activity | 165 / 165 | 1533 / 1721 | 3740 / 3833 | 0 |
| Busy trip: balances | 105 / 106 | 883 / 951 | 2179 / 2358 | 0 |
| Busy trip (type trip): balances | 92 / 95 | 877 / 890 | 2318 / 2414 | 0 |
| Busy trip: charts | 161 / 172 | 1458 / 1545 | 3679 / 3696 | 0 |
| Busy trip: settle up | 47 / 50 | 405 / 409 | 1017 / 1021 | 0 |
| Settle across groups | 66 / 71 | 727 / 739 | 1543 / 1586 | 0 |
| Search “Expense 1” | 392 / 411 | 3940 / 4006 | 9804 / 9842 | 0 |
| Alerts | 59 / 65 | 593 / 672 | 1413 / 1453 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 103 | 41 | 2807 | 545 | 0 | 133 | Member.findMany 43 ms (0 rows) |
| Busy trip: activity | 156 | 12 | 12550 | 113 | 43 | 382 | Group.findUnique 100 ms (12440 rows) |
| Busy trip: balances | 99 | 9 | 2094 | 192 | 0 | 192 | Group.findUnique 62 ms (1583 rows) |
| Busy trip (type trip): balances | 96 | 8 | 2107 | 183 | 0 | 190 | Group.findUnique 63 ms (1583 rows) |
| Busy trip: charts | 147 | 8 | 12250 | 101 | 46 | 194 | Group.findUnique 95 ms (12140 rows) |
| Busy trip: settle up | 42 | 13 | 700 | 118 | 0 | 88 | raw.$queryRaw 21 ms (144 rows) |
| Settle across groups | 68 | 20 | 1135 | 242 | 0 | 204 | Payment.groupBy 36 ms (18 rows) |
| Search “Expense 1” | 393 | 10 | 31465 | 286 | 107 | 433 | Group.findMany 276 ms (31420 rows) |
| Alerts | 59 | 17 | 204 | 27 | 32 | 546 | GroupEvent.findMany 4 ms (100 rows) |
| Busy trip: balances, with Undo bar | 106 | 11 | 2096 | 206 | 0 | 194 | Group.findUnique 65 ms (1583 rows) |
| Trip I left: balances | 32 | 18 | 605 | 33 | 0 | 71 | Group.findUnique 6 ms (77 rows) |
| Trip I left: activity | 62 | 21 | 550 | 25 | 37 | 479 | Group.findUnique 6 ms (380 rows) |

Server busy-ness: the slowest second held the server's single thread up by 3491.76 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1550 ms in total (8 ms each on average).
Balances still add up to zero: yes ✓.