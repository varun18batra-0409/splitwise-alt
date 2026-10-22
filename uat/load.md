# Load test

Seeded 400 people, 120 groups, 6106 expenses, 893 payments in 11 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 347 / 353 | 2694 / 2773 | 6663 / 6705 | 0 |
| Busy trip: activity | 244 / 286 | 1823 / 1858 | 4592 / 4711 | 0 |
| Busy trip: balances | 220 / 243 | 1745 / 1805 | 4336 / 4426 | 0 |
| Busy trip: charts | 224 / 225 | 1730 / 1733 | 4320 / 4435 | 0 |
| Busy trip: settle up | 198 / 203 | 1558 / 1572 | 3949 / 3965 | 0 |
| Settle across groups | 325 / 328 | 2445 / 2453 | 5914 / 5951 | 0 |
| Search “Expense 1” | 401 / 423 | 3184 / 3241 | 7940 / 8033 | 0 |
| Alerts | 100 / 104 | 876 / 947 | 2122 / 2176 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1703 ms in total (9 ms each on average).
Balances still add up to zero: yes ✓.