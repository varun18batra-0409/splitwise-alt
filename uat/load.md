# Load test

Seeded 400 people, 120 groups, 6167 expenses, 892 payments in 12 s.
Heavy user: in 21 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 115 / 120 | 951 / 1042 | 2358 / 2439 | 0 |
| Busy trip: activity | 315 / 341 | 2497 / 2607 | 6091 / 6187 | 0 |
| Busy trip: balances | 267 / 269 | 2125 / 2150 | 5075 / 5181 | 0 |
| Busy trip: charts | 276 / 289 | 2259 / 2264 | 5475 / 5545 | 0 |
| Busy trip: settle up | 73 / 73 | 553 / 557 | 1391 / 1415 | 0 |
| Settle across groups | 81 / 83 | 672 / 678 | 1696 / 1776 | 0 |
| Search “Expense 1” | 463 / 504 | 3595 / 3707 | 9145 / 9361 | 0 |
| Alerts | 116 / 122 | 1028 / 1048 | 2583 / 2658 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 101 | 30 | 1227 | 316 | 0 | 138 | GroupEvent.findMany 28 ms (0 rows) |
| Busy trip: activity | 313 | 15 | 99 | 262 | 51 | 401 | Group.findUnique 197 ms (1 rows) |
| Busy trip: balances | 266 | 12 | 99 | 242 | 24 | 190 | Group.findUnique 196 ms (1 rows) |
| Busy trip: charts | 289 | 12 | 99 | 241 | 48 | 241 | Group.findUnique 193 ms (1 rows) |
| Busy trip: settle up | 68 | 15 | 546 | 174 | 0 | 90 | raw.$queryRaw 33 ms (178 rows) |
| Settle across groups | 82 | 16 | 793 | 200 | 0 | 205 | GroupEvent.findMany 30 ms (0 rows) |
| Search “Expense 1” | 450 | 8 | 64 | 308 | 142 | 434 | Group.findMany 292 ms (21 rows) |
| Alerts | 113 | 17 | 208 | 35 | 78 | 557 | GroupEvent.findMany 7 ms (100 rows) |
| Busy trip: balances, with Undo bar | 262 | 14 | 101 | 240 | 22 | 191 | Group.findUnique 192 ms (1 rows) |
| Trip I left: balances | 46 | 16 | 153 | 34 | 12 | 72 | Group.findUnique 11 ms (1 rows) |
| Trip I left: activity | 299 | 20 | 153 | 38 | 261 | 2057 | Group.findUnique 12 ms (1 rows) |

Server busy-ness: the slowest second held the server's single thread up by 4412.41 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2875 ms in total (14 ms each on average).
Balances still add up to zero: yes ✓.