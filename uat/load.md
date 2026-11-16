# Load test

Seeded 400 people, 120 groups, 6043 expenses, 907 payments in 13 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 110 / 116 | 813 / 898 | 1941 / 2134 | 0 |
| Busy trip: activity | 285 / 291 | 2131 / 2286 | 5359 / 5455 | 0 |
| Busy trip: balances | 224 / 238 | 1726 / 1784 | 4465 / 4616 | 0 |
| Busy trip: charts | 259 / 267 | 1807 / 1868 | 4538 / 4708 | 0 |
| Busy trip: settle up | 57 / 63 | 467 / 486 | 1188 / 1197 | 0 |
| Settle across groups | 73 / 78 | 608 / 662 | 1391 / 1429 | 0 |
| Search “Expense 1” | 398 / 427 | 3208 / 3237 | 7776 / 7847 | 0 |
| Alerts | 98 / 134 | 868 / 963 | 2075 / 2434 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 89 | 29 | 1199 | 273 | 0 | 147 | Postcard.count 27 ms (1 rows) |
| Busy trip: activity | 284 | 14 | 99 | 229 | 55 | 476 | Group.findUnique 178 ms (1 rows) |
| Busy trip: balances | 232 | 11 | 99 | 212 | 20 | 190 | Group.findUnique 159 ms (1 rows) |
| Busy trip: charts | 243 | 11 | 99 | 213 | 30 | 241 | Group.findUnique 170 ms (1 rows) |
| Busy trip: settle up | 55 | 18 | 542 | 145 | 0 | 89 | raw.$queryRaw 26 ms (144 rows) |
| Settle across groups | 68 | 16 | 796 | 168 | 0 | 218 | Payment.groupBy 24 ms (19 rows) |
| Search “Expense 1” | 393 | 7 | 64 | 275 | 118 | 433 | Group.findMany 269 ms (21 rows) |
| Alerts | 95 | 18 | 212 | 32 | 63 | 557 | Member.findMany 7 ms (21 rows) |
| Busy trip: balances, with Undo bar | 230 | 13 | 101 | 210 | 20 | 191 | Group.findUnique 164 ms (1 rows) |
| Trip I left: balances | 37 | 15 | 153 | 28 | 9 | 72 | Group.findUnique 8 ms (1 rows) |
| Trip I left: activity | 251 | 19 | 153 | 34 | 217 | 2171 | Group.findUnique 12 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 3760.19 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2786 ms in total (14 ms each on average).
Balances still add up to zero: yes ✓.