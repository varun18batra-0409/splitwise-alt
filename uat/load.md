# Load test

Seeded 400 people, 120 groups, 6153 expenses, 869 payments in 6 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 228 / 234 | 1698 / 1748 | 4067 / 4259 | 0 |
| Busy trip: activity | 154 / 203 | 1133 / 1161 | 2991 / 3112 | 0 |
| Busy trip: balances | 263 / 274 | 2349 / 2370 | 6236 / 7646 | 0 |
| Busy trip: charts | 149 / 156 | 1088 / 1155 | 2679 / 2708 | 0 |
| Busy trip: settle up | 131 / 131 | 952 / 960 | 2467 / 2577 | 0 |
| Settle across groups | 196 / 234 | 1484 / 1516 | 3725 / 3769 | 0 |
| Search “Expense 1” | 268 / 280 | 1991 / 2016 | 4809 / 5062 | 0 |
| Alerts | 58 / 65 | 498 / 517 | 1189 / 1247 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1129 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.