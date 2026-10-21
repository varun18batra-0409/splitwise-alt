# Load test

Seeded 400 people, 120 groups, 6070 expenses, 923 payments in 11 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 338 / 341 | 2625 / 2701 | 6565 / 6634 | 0 |
| Busy trip: activity | 248 / 251 | 1867 / 1879 | 4647 / 4801 | 0 |
| Busy trip: balances | 246 / 262 | 1754 / 1758 | 4418 / 4476 | 0 |
| Busy trip: charts | 223 / 226 | 1716 / 1723 | 4355 / 4366 | 0 |
| Busy trip: settle up | 205 / 210 | 1515 / 1536 | 3813 / 3922 | 0 |
| Settle across groups | 302 / 304 | 2331 / 2432 | 5759 / 5772 | 0 |
| Search “Expense 1” | 363 / 393 | 2886 / 2926 | 7293 / 7332 | 0 |
| Alerts | 97 / 99 | 837 / 845 | 2094 / 2161 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1952 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.