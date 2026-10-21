# Load test

Seeded 400 people, 120 groups, 6276 expenses, 907 payments in 11 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 354 / 356 | 2779 / 2829 | 6801 / 6841 | 0 |
| Busy trip: activity | 237 / 240 | 1798 / 1896 | 4393 / 4545 | 0 |
| Busy trip: balances | 226 / 244 | 1702 / 1813 | 4245 / 4300 | 0 |
| Busy trip: charts | 224 / 226 | 1683 / 1713 | 4113 / 4310 | 0 |
| Busy trip: settle up | 196 / 197 | 1523 / 1578 | 3698 / 3860 | 0 |
| Settle across groups | 328 / 329 | 2480 / 2488 | 6070 / 6135 | 0 |
| Search “Expense 1” | 388 / 414 | 3033 / 3052 | 7598 / 7770 | 0 |
| Alerts | 89 / 92 | 795 / 834 | 1960 / 2026 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1881 ms in total (9 ms each on average).
Balances still add up to zero: yes ✓.