# Load test

Seeded 400 people, 120 groups, 5884 expenses, 880 payments in 10 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 328 / 335 | 2578 / 2636 | 6505 / 6635 | 0 |
| Busy trip: activity | 234 / 234 | 1829 / 1841 | 4550 / 4669 | 0 |
| Busy trip: balances | 215 / 237 | 1741 / 1800 | 4233 / 4335 | 0 |
| Busy trip: charts | 222 / 224 | 1707 / 1744 | 4143 / 4268 | 0 |
| Busy trip: settle up | 196 / 196 | 1517 / 1585 | 3761 / 3860 | 0 |
| Settle across groups | 300 / 302 | 2348 / 2459 | 5768 / 5838 | 0 |
| Search “Expense 1” | 361 / 380 | 2908 / 2984 | 7227 / 7342 | 0 |
| Alerts | 94 / 97 | 821 / 829 | 2061 / 2099 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1850 ms in total (9 ms each on average).
Balances still add up to zero: yes ✓.