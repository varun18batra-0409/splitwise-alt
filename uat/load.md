# Load test

Seeded 400 people, 120 groups, 6186 expenses, 872 payments in 12 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 387 / 395 | 2861 / 3065 | 7138 / 7253 | 0 |
| Busy trip: activity | 250 / 255 | 1951 / 1961 | 4798 / 4861 | 0 |
| Busy trip: balances | 222 / 248 | 1789 / 1832 | 4544 / 4651 | 0 |
| Busy trip: charts | 238 / 238 | 1779 / 1852 | 4337 / 4419 | 0 |
| Busy trip: settle up | 207 / 209 | 1597 / 1648 | 3950 / 3968 | 0 |
| Settle across groups | 336 / 338 | 2612 / 2684 | 6363 / 6382 | 0 |
| Search “Expense 1” | 442 / 443 | 3349 / 3580 | 8458 / 8626 | 0 |
| Alerts | 104 / 108 | 881 / 941 | 2215 / 2253 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2052 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.