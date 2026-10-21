# Load test

Seeded 400 people, 120 groups, 6116 expenses, 883 payments in 7 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 222 / 231 | 1662 / 1678 | 4267 / 4307 | 0 |
| Busy trip: activity | 155 / 158 | 1164 / 1226 | 2822 / 2931 | 0 |
| Busy trip: balances | 146 / 161 | 1077 / 1087 | 2666 / 2831 | 0 |
| Busy trip: charts | 148 / 154 | 1065 / 1238 | 2752 / 2782 | 0 |
| Busy trip: settle up | 135 / 138 | 952 / 961 | 2271 / 2340 | 0 |
| Settle across groups | 195 / 211 | 1555 / 1591 | 3687 / 3851 | 0 |
| Search “Expense 1” | 232 / 232 | 1868 / 2054 | 4531 / 4692 | 0 |
| Alerts | 56 / 61 | 497 / 524 | 1284 / 1337 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1688 ms in total (8 ms each on average).
Balances still add up to zero: yes ✓.