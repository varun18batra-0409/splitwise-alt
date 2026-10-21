# Load test

Seeded 400 people, 120 groups, 6357 expenses, 857 payments in 12 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 364 / 364 | 2842 / 2880 | 7096 / 7131 | 0 |
| Busy trip: activity | 248 / 252 | 1909 / 1998 | 4626 / 4725 | 0 |
| Busy trip: balances | 230 / 249 | 1810 / 1815 | 4531 / 4630 | 0 |
| Busy trip: charts | 231 / 243 | 1756 / 1837 | 4490 / 4568 | 0 |
| Busy trip: settle up | 223 / 226 | 1647 / 1702 | 4049 / 4165 | 0 |
| Settle across groups | 358 / 360 | 2681 / 2705 | 6453 / 6506 | 0 |
| Search “Expense 1” | 440 / 453 | 3346 / 3386 | 8139 / 8269 | 0 |
| Alerts | 107 / 108 | 952 / 969 | 2319 / 2460 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2129 ms in total (11 ms each on average).
Balances still add up to zero: yes ✓.