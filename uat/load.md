# Load test

Seeded 400 people, 120 groups, 6093 expenses, 853 payments in 6 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 192 / 199 | 1483 / 1562 | 3730 / 3851 | 0 |
| Busy trip: activity | 141 / 145 | 1023 / 1131 | 2572 / 2656 | 0 |
| Busy trip: balances | 129 / 141 | 991 / 1043 | 2427 / 2512 | 0 |
| Busy trip: charts | 129 / 131 | 969 / 985 | 2461 / 2505 | 0 |
| Busy trip: settle up | 121 / 127 | 879 / 882 | 2188 / 2272 | 0 |
| Settle across groups | 181 / 182 | 1355 / 1391 | 3421 / 3437 | 0 |
| Search “Expense 1” | 229 / 235 | 1691 / 1723 | 4210 / 4239 | 0 |
| Alerts | 53 / 54 | 419 / 431 | 1075 / 1116 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1178 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.