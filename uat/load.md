# Load test

Seeded 400 people, 120 groups, 7586 expenses, 1214 payments in 17 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 135 / 142 | 1216 / 1284 | 2784 / 2817 | 0 |
| Busy trip: activity | 193 / 203 | 1908 / 2240 | 4778 / 4955 | 0 |
| Busy trip: balances | 123 / 140 | 1145 / 1286 | 2857 / 2882 | 0 |
| Busy trip (type trip): balances | 144 / 145 | 1135 / 1150 | 2851 / 2905 | 0 |
| Busy trip: charts | 201 / 203 | 1897 / 1922 | 4559 / 4639 | 0 |
| Busy trip: settle up | 59 / 65 | 480 / 493 | 1199 / 1215 | 0 |
| Settle across groups | 84 / 88 | 766 / 778 | 1950 / 2010 | 0 |
| Search “Expense 1” | 518 / 525 | 4933 / 4943 | 12612 / 12771 | 0 |
| Alerts | 75 / 193 | 733 / 787 | 1773 / 1816 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 123 | 41 | 2648 | 687 | 0 | 133 | Member.findMany 55 ms (0 rows) |
| Busy trip: activity | 191 | 12 | 12525 | 139 | 52 | 346 | Group.findUnique 124 ms (12415 rows) |
| Busy trip: balances | 120 | 9 | 2116 | 227 | 0 | 192 | Group.findUnique 74 ms (1583 rows) |
| Busy trip (type trip): balances | 118 | 8 | 2091 | 223 | 0 | 190 | Group.findUnique 74 ms (1583 rows) |
| Busy trip: charts | 185 | 8 | 12225 | 129 | 56 | 194 | Group.findUnique 118 ms (12115 rows) |
| Busy trip: settle up | 50 | 13 | 714 | 144 | 0 | 89 | raw.$queryRaw 27 ms (179 rows) |
| Settle across groups | 84 | 20 | 1187 | 293 | 0 | 209 | Payment.groupBy 45 ms (21 rows) |
| Search “Expense 1” | 505 | 10 | 30811 | 366 | 139 | 430 | Group.findMany 355 ms (30766 rows) |
| Alerts | 70 | 17 | 203 | 31 | 39 | 546 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 125 | 11 | 2118 | 236 | 0 | 194 | Group.findUnique 72 ms (1583 rows) |
| Trip I left: balances | 39 | 18 | 616 | 41 | 0 | 72 | Group.findUnique 7 ms (77 rows) |
| Trip I left: activity | 88 | 21 | 561 | 34 | 54 | 535 | Group.findUnique 8 ms (391 rows) |

Server busy-ness: the slowest second held the server's single thread up by 4659.87 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1815 ms in total (9 ms each on average).
Balances still add up to zero: yes ✓.