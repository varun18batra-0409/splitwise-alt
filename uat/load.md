# Load test

Seeded 400 people, 120 groups, 6359 expenses, 943 payments in 12 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 354 / 356 | 2567 / 2694 | 6640 / 6794 | 0 |
| Busy trip: activity | 234 / 236 | 1837 / 1893 | 4655 / 4693 | 0 |
| Busy trip: balances | 220 / 243 | 1717 / 1747 | 4367 / 4392 | 0 |
| Busy trip: charts | 224 / 232 | 1741 / 1745 | 4328 / 4363 | 0 |
| Busy trip: settle up | 206 / 208 | 1537 / 1620 | 3848 / 3954 | 0 |
| Settle across groups | 319 / 325 | 2441 / 2464 | 6061 / 6103 | 0 |
| Search “Expense 1” | 399 / 419 | 3064 / 3181 | 7528 / 7564 | 0 |
| Alerts | 101 / 101 | 874 / 919 | 2108 / 2176 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1960 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.