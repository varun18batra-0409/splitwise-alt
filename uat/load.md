# Load test

Seeded 400 people, 120 groups, 6209 expenses, 884 payments in 9 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 253 / 268 | 1957 / 2082 | 4979 / 5037 | 0 |
| Busy trip: activity | 185 / 197 | 1474 / 1527 | 3529 / 3631 | 0 |
| Busy trip: balances | 348 / 351 | 3147 / 3166 | 7807 / 8104 | 0 |
| Busy trip: charts | 176 / 179 | 1353 / 2886 | 3276 / 3437 | 0 |
| Busy trip: settle up | 158 / 158 | 1203 / 1214 | 3067 / 3087 | 0 |
| Settle across groups | 245 / 251 | 1839 / 1886 | 4675 / 4716 | 0 |
| Search “Expense 1” | 316 / 318 | 2407 / 2549 | 5988 / 6082 | 0 |
| Alerts | 102 / 158 | 652 / 739 | 1607 / 1758 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1799 ms in total (9 ms each on average).
Balances still add up to zero: yes ✓.