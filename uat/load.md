# Load test

Seeded 400 people, 120 groups, 7258 expenses, 1192 payments in 10 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 84 / 85 | 759 / 775 | 1636 / 1815 | 0 |
| Busy trip: activity | 124 / 124 | 1215 / 1245 | 3144 / 3317 | 0 |
| Busy trip: balances | 72 / 74 | 698 / 736 | 1692 / 1747 | 0 |
| Busy trip (type trip): balances | 72 / 73 | 660 / 677 | 1703 / 1715 | 0 |
| Busy trip: charts | 138 / 142 | 1201 / 1306 | 3115 / 3151 | 0 |
| Busy trip: settle up | 34 / 43 | 301 / 335 | 744 / 760 | 0 |
| Settle across groups | 52 / 52 | 451 / 555 | 1082 / 1164 | 0 |
| Search “Expense 1” | 325 / 356 | 3154 / 3205 | 8260 / 8415 | 0 |
| Alerts | 51 / 54 | 441 / 538 | 1149 / 1170 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 85 | 41 | 2677 | 446 | 0 | 133 | Member.findMany 32 ms (0 rows) |
| Busy trip: activity | 132 | 12 | 12460 | 92 | 40 | 427 | Group.findUnique 79 ms (12350 rows) |
| Busy trip: balances | 74 | 9 | 2115 | 135 | 0 | 192 | Group.findUnique 42 ms (1583 rows) |
| Busy trip (type trip): balances | 73 | 8 | 2074 | 130 | 0 | 190 | Group.findUnique 41 ms (1583 rows) |
| Busy trip: charts | 125 | 8 | 12160 | 86 | 39 | 194 | Group.findUnique 82 ms (12050 rows) |
| Busy trip: settle up | 39 | 13 | 735 | 88 | 0 | 87 | raw.$queryRaw 16 ms (144 rows) |
| Settle across groups | 50 | 20 | 1173 | 170 | 0 | 208 | Payment.groupBy 27 ms (21 rows) |
| Search “Expense 1” | 337 | 10 | 30634 | 225 | 112 | 432 | Group.findMany 239 ms (30589 rows) |
| Alerts | 45 | 17 | 200 | 19 | 26 | 546 | CollectionEntry.findMany 6 ms (0 rows) |
| Busy trip: balances, with Undo bar | 80 | 11 | 2117 | 142 | 0 | 194 | Group.findUnique 44 ms (1583 rows) |
| Trip I left: balances | 26 | 18 | 608 | 25 | 1 | 72 | Group.findUnique 4 ms (77 rows) |
| Trip I left: activity | 49 | 21 | 551 | 18 | 31 | 513 | Group.findUnique 5 ms (381 rows) |

Server busy-ness: the slowest second held the server's single thread up by 7780.43 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1241 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.