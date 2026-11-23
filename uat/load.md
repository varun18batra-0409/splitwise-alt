# Load test

Seeded 400 people, 120 groups, 7500 expenses, 1199 payments in 11 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 87 / 92 | 786 / 809 | 1779 / 1797 | 0 |
| Busy trip: activity | 122 / 122 | 1159 / 1205 | 2979 / 3217 | 0 |
| Busy trip: balances | 78 / 80 | 725 / 739 | 1844 / 1857 | 0 |
| Busy trip (type trip): balances | 78 / 82 | 742 / 788 | 1772 / 1801 | 0 |
| Busy trip: charts | 137 / 170 | 1223 / 1255 | 2964 / 3004 | 0 |
| Busy trip: settle up | 39 / 47 | 346 / 405 | 780 / 803 | 0 |
| Settle across groups | 52 / 56 | 485 / 491 | 1194 / 1249 | 0 |
| Search “Expense 1” | 300 / 395 | 3001 / 3080 | 7498 / 7593 | 0 |
| Alerts | 74 / 133 | 439 / 445 | 1143 / 1169 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 82 | 41 | 2772 | 435 | 0 | 133 | Member.findMany 34 ms (0 rows) |
| Busy trip: activity | 131 | 12 | 12491 | 91 | 40 | 345 | Group.findUnique 86 ms (12381 rows) |
| Busy trip: balances | 82 | 9 | 2103 | 154 | 0 | 192 | Group.findUnique 47 ms (1583 rows) |
| Busy trip (type trip): balances | 84 | 8 | 2110 | 153 | 0 | 190 | Group.findUnique 48 ms (1583 rows) |
| Busy trip: charts | 136 | 8 | 12191 | 90 | 46 | 193 | Group.findUnique 83 ms (12081 rows) |
| Busy trip: settle up | 42 | 13 | 691 | 111 | 0 | 88 | raw.$queryRaw 20 ms (144 rows) |
| Settle across groups | 59 | 20 | 1138 | 207 | 0 | 219 | Payment.groupBy 29 ms (21 rows) |
| Search “Expense 1” | 300 | 10 | 30144 | 205 | 95 | 434 | Group.findMany 193 ms (30099 rows) |
| Alerts | 46 | 17 | 213 | 19 | 27 | 546 | GroupEvent.findMany 3 ms (100 rows) |
| Busy trip: balances, with Undo bar | 84 | 11 | 2105 | 164 | 0 | 194 | Group.findUnique 51 ms (1583 rows) |
| Trip I left: balances | 31 | 18 | 606 | 29 | 2 | 72 | Group.findUnique 8 ms (77 rows) |
| Trip I left: activity | 46 | 21 | 551 | 19 | 27 | 428 | Group.findUnique 6 ms (381 rows) |

Server busy-ness: the slowest second held the server's single thread up by 6606.03 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1262 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.