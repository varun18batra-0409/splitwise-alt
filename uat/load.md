# Load test

Seeded 400 people, 120 groups, 7306 expenses, 1217 payments in 16 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 133 / 146 | 1170 / 1240 | 2669 / 2812 | 0 |
| Busy trip: activity | 182 / 186 | 1887 / 2007 | 4532 / 4666 | 0 |
| Busy trip: balances | 113 / 116 | 1043 / 1054 | 2552 / 2651 | 0 |
| Busy trip (type trip): balances | 110 / 144 | 1039 / 1051 | 2605 / 2750 | 0 |
| Busy trip: charts | 186 / 272 | 1695 / 1746 | 4253 / 4286 | 0 |
| Busy trip: settle up | 49 / 55 | 469 / 492 | 1174 / 1256 | 0 |
| Settle across groups | 80 / 92 | 730 / 750 | 1935 / 1977 | 0 |
| Search “Expense 1” | 514 / 538 | 4961 / 4984 | 12511 / 12807 | 0 |
| Alerts | 65 / 148 | 624 / 664 | 1564 / 1633 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 113 | 41 | 2843 | 617 | 0 | 134 | Member.findMany 49 ms (0 rows) |
| Busy trip: activity | 177 | 13 | 12443 | 127 | 50 | 384 | Group.findUnique 122 ms (12333 rows) |
| Busy trip: balances | 110 | 9 | 2089 | 206 | 0 | 193 | Group.findUnique 68 ms (1583 rows) |
| Busy trip (type trip): balances | 109 | 8 | 2133 | 206 | 0 | 190 | Group.findUnique 68 ms (1583 rows) |
| Busy trip: charts | 177 | 8 | 12143 | 120 | 57 | 194 | Group.findUnique 124 ms (12033 rows) |
| Busy trip: settle up | 49 | 13 | 710 | 136 | 0 | 90 | raw.$queryRaw 25 ms (144 rows) |
| Settle across groups | 80 | 20 | 1159 | 290 | 0 | 227 | Payment.groupBy 44 ms (20 rows) |
| Search “Expense 1” | 495 | 78 | 32618 | 11329 | 0 | 438 | Expense.findMany 329 ms (1847 rows) |
| Alerts | 64 | 17 | 204 | 29 | 35 | 546 | CollectionEntry.findMany 7 ms (0 rows) |
| Busy trip: balances, with Undo bar | 114 | 11 | 2091 | 212 | 0 | 194 | Group.findUnique 67 ms (1583 rows) |
| Trip I left: balances | 37 | 18 | 638 | 38 | 0 | 72 | Group.findUnique 6 ms (77 rows) |
| Trip I left: activity | 73 | 21 | 577 | 28 | 45 | 522 | Group.findUnique 8 ms (407 rows) |

Server busy-ness: the slowest second held the server's single thread up by 11819.55 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1662 ms in total (8 ms each on average).
Balances still add up to zero: yes ✓.