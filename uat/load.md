# Load test

Seeded 400 people, 120 groups, 6329 expenses, 787 payments in 7 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 218 / 228 | 1665 / 1670 | 4166 / 4216 | 0 |
| Busy trip: activity | 146 / 148 | 1091 / 1106 | 2756 / 2884 | 0 |
| Busy trip: balances | 145 / 156 | 1066 / 1073 | 2671 / 2697 | 0 |
| Busy trip: charts | 135 / 146 | 985 / 1037 | 2458 / 2546 | 0 |
| Busy trip: settle up | 130 / 134 | 950 / 960 | 2378 / 2454 | 0 |
| Settle across groups | 209 / 220 | 1592 / 1609 | 3973 / 4022 | 0 |
| Search “Expense 1” | 253 / 268 | 1930 / 1949 | 4726 / 4821 | 0 |
| Alerts | 36 / 45 | 271 / 275 | 661 / 719 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1462 ms in total (7 ms each on average).
Balances still add up to zero: yes ✓.