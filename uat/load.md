# Load test

Seeded 400 people, 120 groups, 6116 expenses, 892 payments in 11 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 324 / 325 | 2460 / 2533 | 6034 / 6206 | 0 |
| Busy trip: activity | 230 / 242 | 1871 / 1929 | 4512 / 4526 | 0 |
| Busy trip: balances | 219 / 246 | 1686 / 1693 | 4249 / 4382 | 0 |
| Busy trip: charts | 220 / 220 | 1595 / 1615 | 3985 / 4132 | 0 |
| Busy trip: settle up | 204 / 207 | 1526 / 1556 | 3836 / 3849 | 0 |
| Settle across groups | 306 / 309 | 2301 / 2331 | 5703 / 5810 | 0 |
| Search “Expense 1” | 364 / 383 | 2853 / 2934 | 7307 / 7325 | 0 |
| Alerts | 63 / 64 | 473 / 498 | 1155 / 1182 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1972 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.