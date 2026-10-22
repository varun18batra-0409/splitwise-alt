# Load test

Seeded 400 people, 120 groups, 6212 expenses, 865 payments in 12 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 342 / 354 | 2657 / 2775 | 6864 / 6908 | 0 |
| Busy trip: activity | 243 / 245 | 1910 / 2008 | 4827 / 4846 | 0 |
| Busy trip: balances | 234 / 256 | 1814 / 1829 | 4493 / 4613 | 0 |
| Busy trip: charts | 239 / 242 | 1789 / 1898 | 4431 / 4560 | 0 |
| Busy trip: settle up | 212 / 213 | 1619 / 1653 | 4074 / 4097 | 0 |
| Settle across groups | 324 / 324 | 2516 / 2601 | 6173 / 6222 | 0 |
| Search “Expense 1” | 431 / 450 | 3295 / 3312 | 8236 / 8274 | 0 |
| Alerts | 103 / 105 | 898 / 912 | 2283 / 2318 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2142 ms in total (11 ms each on average).
Balances still add up to zero: yes ✓.