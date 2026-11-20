# Load test

Seeded 400 people, 120 groups, 6350 expenses, 889 payments in 14 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 101 / 107 | 910 / 946 | 1984 / 2141 | 0 |
| Busy trip: activity | 197 / 198 | 1904 / 1928 | 4691 / 4806 | 0 |
| Busy trip: balances | 189 / 192 | 1791 / 1837 | 4287 / 4317 | 0 |
| Busy trip: charts | 188 / 270 | 1757 / 1903 | 4412 / 4467 | 0 |
| Busy trip: settle up | 56 / 57 | 483 / 498 | 1180 / 1188 | 0 |
| Settle across groups | 65 / 66 | 609 / 668 | 1475 / 1524 | 0 |
| Search “Expense 1” | 308 / 416 | 2859 / 2911 | 7242 / 7392 | 0 |
| Alerts | 76 / 77 | 707 / 734 | 1611 / 1661 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 88 | 37 | 1266 | 461 | 0 | 133 | Member.findMany 37 ms (0 rows) |
| Busy trip: activity | 191 | 15 | 99 | 131 | 60 | 386 | Group.findUnique 113 ms (1 rows) |
| Busy trip: balances | 169 | 12 | 99 | 119 | 50 | 192 | Group.findUnique 109 ms (1 rows) |
| Busy trip: charts | 174 | 12 | 99 | 119 | 55 | 194 | Group.findUnique 109 ms (1 rows) |
| Busy trip: settle up | 51 | 15 | 542 | 140 | 0 | 90 | raw.$queryRaw 25 ms (182 rows) |
| Settle across groups | 60 | 21 | 747 | 182 | 0 | 197 | Payment.groupBy 26 ms (20 rows) |
| Search “Expense 1” | 306 | 11 | 64 | 185 | 121 | 434 | Group.findMany 174 ms (21 rows) |
| Alerts | 65 | 18 | 203 | 30 | 35 | 546 | Member.findMany 6 ms (15 rows) |
| Busy trip: balances, with Undo bar | 170 | 14 | 101 | 119 | 51 | 193 | Group.findUnique 112 ms (1 rows) |
| Trip I left: balances | 32 | 20 | 153 | 24 | 8 | 72 | Group.findUnique 7 ms (1 rows) |
| Trip I left: activity | 82 | 24 | 153 | 32 | 50 | 493 | Group.findUnique 13 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 3462.4 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1626 ms in total (8 ms each on average).
Balances still add up to zero: yes ✓.