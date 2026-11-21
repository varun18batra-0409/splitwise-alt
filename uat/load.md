# Load test

Seeded 400 people, 120 groups, 7341 expenses, 1180 payments in 11 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 89 / 97 | 787 / 835 | 1805 / 1873 | 0 |
| Busy trip: activity | 128 / 131 | 1225 / 1290 | 3155 / 3202 | 0 |
| Busy trip: balances | 81 / 95 | 731 / 742 | 1883 / 1976 | 0 |
| Busy trip (type trip): balances | 77 / 81 | 721 / 727 | 1800 / 1911 | 0 |
| Busy trip: charts | 144 / 200 | 1155 / 1199 | 2847 / 2887 | 0 |
| Busy trip: settle up | 34 / 45 | 318 / 331 | 793 / 867 | 0 |
| Settle across groups | 57 / 59 | 526 / 589 | 1242 / 1257 | 0 |
| Search “Expense 1” | 330 / 344 | 3022 / 3067 | 7508 / 7619 | 0 |
| Alerts | 57 / 111 | 445 / 470 | 1188 / 1228 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 88 | 41 | 2637 | 466 | 0 | 133 | Member.findMany 37 ms (0 rows) |
| Busy trip: activity | 128 | 12 | 12527 | 90 | 38 | 389 | Group.findUnique 78 ms (12417 rows) |
| Busy trip: balances | 81 | 9 | 2117 | 161 | 0 | 192 | Group.findUnique 52 ms (1583 rows) |
| Busy trip (type trip): balances | 81 | 8 | 2083 | 154 | 0 | 190 | Group.findUnique 50 ms (1583 rows) |
| Busy trip: charts | 122 | 8 | 12227 | 81 | 41 | 194 | Group.findUnique 74 ms (12117 rows) |
| Busy trip: settle up | 36 | 13 | 728 | 92 | 0 | 91 | raw.$queryRaw 17 ms (185 rows) |
| Settle across groups | 56 | 20 | 1176 | 187 | 0 | 239 | GroupEvent.findMany 28 ms (0 rows) |
| Search “Expense 1” | 310 | 10 | 30189 | 218 | 92 | 436 | Group.findMany 210 ms (30144 rows) |
| Alerts | 51 | 17 | 206 | 21 | 30 | 546 | GroupEvent.findMany 3 ms (100 rows) |
| Busy trip: balances, with Undo bar | 87 | 11 | 2119 | 169 | 0 | 194 | Group.findUnique 57 ms (1583 rows) |
| Trip I left: balances | 27 | 18 | 618 | 27 | 0 | 72 | Group.findUnique 5 ms (77 rows) |
| Trip I left: activity | 53 | 21 | 563 | 20 | 33 | 511 | Group.findUnique 11 ms (393 rows) |

Server busy-ness: the slowest second held the server's single thread up by 2772.43 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1289 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.