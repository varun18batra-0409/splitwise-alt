# Load test

Seeded 400 people, 120 groups, 7744 expenses, 1124 payments in 18 s.
Heavy user: in 22 groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.
Also a trip the heavy user left.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 151 / 155 | 1387 / 1440 | 3196 / 3353 | 0 |
| Busy trip: activity | 223 / 351 | 2040 / 2095 | 5129 / 5272 | 0 |
| Busy trip: balances | 130 / 144 | 1242 / 1272 | 2983 / 3158 | 0 |
| Busy trip (type trip): balances | 119 / 122 | 1134 / 1149 | 2836 / 2967 | 0 |
| Busy trip: charts | 208 / 211 | 1831 / 1841 | 4547 / 4590 | 0 |
| Busy trip: settle up | 57 / 67 | 500 / 508 | 1289 / 1300 | 0 |
| Settle across groups | 95 / 204 | 811 / 837 | 1935 / 1975 | 0 |
| Search “Expense 1” | 541 / 551 | 5164 / 5217 | 13119 / 13246 | 0 |
| Alerts | 72 / 128 | 705 / 731 | 1743 / 1797 | 0 |

## One person at a time (median of 5 requests, one after another)

| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |
|---|---|---|---|---|---|---|---|
| Home | 139 | 41 | 2961 | 734 | 0 | 133 | Member.findMany 54 ms (0 rows) |
| Busy trip: activity | 190 | 13 | 12515 | 136 | 54 | 392 | Group.findUnique 121 ms (12405 rows) |
| Busy trip: balances | 118 | 9 | 2095 | 230 | 0 | 193 | Group.findUnique 72 ms (1583 rows) |
| Busy trip (type trip): balances | 118 | 8 | 2095 | 224 | 0 | 191 | Group.findUnique 68 ms (1583 rows) |
| Busy trip: charts | 179 | 8 | 12215 | 126 | 53 | 193 | Group.findUnique 113 ms (12105 rows) |
| Busy trip: settle up | 50 | 13 | 721 | 142 | 0 | 89 | raw.$queryRaw 28 ms (144 rows) |
| Settle across groups | 82 | 20 | 1179 | 298 | 0 | 229 | GroupEvent.findMany 43 ms (0 rows) |
| Search “Expense 1” | 540 | 78 | 32638 | 12704 | 0 | 432 | Expense.findMany 354 ms (1814 rows) |
| Alerts | 73 | 17 | 214 | 32 | 41 | 547 | GroupEvent.findMany 5 ms (100 rows) |
| Busy trip: balances, with Undo bar | 128 | 11 | 2097 | 239 | 0 | 194 | Group.findUnique 75 ms (1583 rows) |
| Trip I left: balances | 39 | 18 | 627 | 40 | 0 | 73 | Group.findUnique 8 ms (77 rows) |
| Trip I left: activity | 84 | 21 | 572 | 30 | 54 | 493 | Group.findUnique 9 ms (402 rows) |

Server busy-ness: the slowest second held the server's single thread up by 12171.87 ms (99th percentile within that second).

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2008 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.