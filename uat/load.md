# Load test

Seeded 400 people, 120 groups, 6232 expenses, 896 payments in 12 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 362 / 368 | 2691 / 2868 | 6897 / 6917 | 0 |
| Busy trip: activity | 278 / 293 | 1876 / 1967 | 4609 / 4737 | 0 |
| Busy trip: balances | 250 / 294 | 1845 / 1926 | 4483 / 4517 | 0 |
| Busy trip: charts | 242 / 243 | 1759 / 1774 | 4426 / 4461 | 0 |
| Busy trip: settle up | 215 / 222 | 1577 / 1605 | 3925 / 4036 | 0 |
| Settle across groups | 337 / 342 | 2450 / 2520 | 6012 / 6208 | 0 |
| Search “Expense 1” | 398 / 401 | 2986 / 3004 | 7410 / 7439 | 0 |
| Alerts | 96 / 96 | 840 / 849 | 2039 / 2188 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1897 ms in total (9 ms each on average).
Balances still add up to zero: yes ✓.