# Load test

Seeded 400 people, 120 groups, 7609 expenses, 1231 payments in 12 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 94 / 100 | 832 / 885 | 1852 / 1937 | 0 |
| Busy trip: activity | 136 / 137 | 1259 / 1338 | 3214 / 3457 | 0 |
| Busy trip: balances | 81 / 86 | 751 / 772 | 1849 / 1868 | 0 |
| Busy trip (type trip): balances | 84 / 85 | 729 / 735 | 1799 / 1912 | 0 |
| Busy trip: charts | 145 / 210 | 1160 / 1190 | 2938 / 2968 | 0 |
| Busy trip: settle up | 41 / 44 | 336 / 340 | 803 / 917 | 0 |
| Settle across groups | 53 / 57 | 498 / 502 | 1232 / 1356 | 0 |
| Search “Expense 1” | 309 / 318 | 3064 / 3242 | 8022 / 8080 | 0 |
| Alerts | 54 / 151 | 488 / 496 | 1209 / 1231 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 93 | 41 | 2660 | 490 | 0 | 133 | Member.findMany 40 ms (0 rows) |
| Busy trip: activity | 134 | 12 | 12434 | 96 | 38 | 386 | Group.findUnique 84 ms (12324 rows) |
| Busy trip: balances | 83 | 9 | 2100 | 164 | 0 | 192 | Group.findUnique 53 ms (1583 rows) |
| Busy trip (type trip): balances | 85 | 8 | 2095 | 159 | 0 | 190 | Group.findUnique 51 ms (1583 rows) |
| Busy trip: charts | 125 | 8 | 12134 | 85 | 40 | 194 | Group.findUnique 76 ms (12024 rows) |
| Busy trip: settle up | 43 | 13 | 730 | 95 | 0 | 94 | raw.$queryRaw 28 ms (144 rows) |
| Settle across groups | 56 | 20 | 1046 | 195 | 0 | 207 | Payment.groupBy 29 ms (19 rows) |
| Search “Expense 1” | 325 | 10 | 29593 | 224 | 101 | 434 | Group.findMany 220 ms (29548 rows) |
| Alerts | 51 | 17 | 210 | 21 | 30 | 546 | CollectionEntry.findMany 7 ms (0 rows) |
| Busy trip: balances, with Undo bar | 88 | 11 | 2102 | 167 | 0 | 194 | Group.findUnique 53 ms (1583 rows) |
| Trip I left: balances | 30 | 18 | 616 | 28 | 2 | 71 | Group.findUnique 5 ms (77 rows) |
| Trip I left: activity | 55 | 21 | 557 | 19 | 36 | 542 | Group.findUnique 6 ms (387 rows) |

Server busy-ness: the slowest second held the server's single thread up by 7222.59 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1296 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.