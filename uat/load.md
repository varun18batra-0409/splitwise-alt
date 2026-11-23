# Load test

Seeded 400 people, 120 groups, 7329 expenses, 1280 payments in 11 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 96 / 104 | 868 / 921 | 1994 / 2077 | 0 |
| Busy trip: activity | 133 / 144 | 1251 / 1341 | 3293 / 3511 | 0 |
| Busy trip: balances | 88 / 99 | 782 / 805 | 1914 / 1923 | 0 |
| Busy trip (type trip): balances | 83 / 91 | 830 / 855 | 1902 / 1952 | 0 |
| Busy trip: charts | 136 / 143 | 1243 / 1344 | 3160 / 3372 | 0 |
| Busy trip: settle up | 38 / 44 | 345 / 436 | 847 / 857 | 0 |
| Settle across groups | 59 / 63 | 528 / 538 | 1256 / 1268 | 0 |
| Search “Expense 1” | 443 / 629 | 4034 / 4075 | 10251 / 10356 | 0 |
| Alerts | 54 / 58 | 484 / 492 | 1225 / 1284 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 94 | 41 | 2844 | 482 | 0 | 133 | Member.findMany 38 ms (0 rows) |
| Busy trip: activity | 133 | 13 | 12581 | 95 | 38 | 343 | Group.findUnique 85 ms (12471 rows) |
| Busy trip: balances | 87 | 9 | 2127 | 161 | 0 | 193 | Group.findUnique 49 ms (1583 rows) |
| Busy trip (type trip): balances | 85 | 8 | 2096 | 158 | 0 | 191 | Group.findUnique 48 ms (1583 rows) |
| Busy trip: charts | 129 | 8 | 12281 | 88 | 41 | 193 | Group.findUnique 81 ms (12171 rows) |
| Busy trip: settle up | 37 | 13 | 693 | 95 | 0 | 89 | raw.$queryRaw 17 ms (144 rows) |
| Settle across groups | 57 | 20 | 1166 | 196 | 0 | 203 | Payment.groupBy 29 ms (21 rows) |
| Search “Expense 1” | 400 | 78 | 30958 | 9122 | 0 | 432 | Expense.findMany 219 ms (1914 rows) |
| Alerts | 54 | 17 | 206 | 22 | 32 | 546 | GroupEvent.findMany 3 ms (100 rows) |
| Busy trip: balances, with Undo bar | 90 | 11 | 2129 | 168 | 0 | 194 | Group.findUnique 54 ms (1583 rows) |
| Trip I left: balances | 31 | 18 | 629 | 28 | 3 | 73 | Group.findUnique 5 ms (77 rows) |
| Trip I left: activity | 61 | 21 | 572 | 24 | 37 | 522 | Group.findUnique 11 ms (402 rows) |

Server busy-ness: the slowest second held the server's single thread up by 8434.75 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1315 ms in total (7 ms each on average).
Balances still add up to zero: yes ✓.