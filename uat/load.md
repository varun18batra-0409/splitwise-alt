# Load test

Seeded 400 people, 120 groups, 6021 expenses, 878 payments in 12 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 334 / 336 | 2575 / 2592 | 6422 / 6433 | 0 |
| Busy trip: activity | 234 / 245 | 1807 / 1822 | 4505 / 4610 | 0 |
| Busy trip: balances | 221 / 234 | 1695 / 1752 | 4216 / 4264 | 0 |
| Busy trip: charts | 215 / 218 | 1577 / 1592 | 4039 / 4060 | 0 |
| Busy trip: settle up | 197 / 205 | 1495 / 1590 | 3738 / 3792 | 0 |
| Settle across groups | 320 / 321 | 2426 / 2489 | 6073 / 6083 | 0 |
| Search “Expense 1” | 377 / 402 | 3030 / 3080 | 7532 / 7580 | 0 |
| Alerts | 60 / 68 | 477 / 480 | 1168 / 1178 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1923 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.