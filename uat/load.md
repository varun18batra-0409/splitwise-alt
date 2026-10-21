# Load test

Seeded 400 people, 120 groups, 6017 expenses, 910 payments in 10 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 319 / 325 | 2507 / 2630 | 6267 / 6308 | 0 |
| Busy trip: activity | 231 / 231 | 1730 / 1739 | 4355 / 4425 | 0 |
| Busy trip: balances | 220 / 240 | 1661 / 1664 | 4177 / 4273 | 0 |
| Busy trip: charts | 217 / 218 | 1655 / 1752 | 4227 / 4242 | 0 |
| Busy trip: settle up | 197 / 197 | 1492 / 1567 | 3718 / 3780 | 0 |
| Settle across groups | 300 / 307 | 2354 / 2506 | 5741 / 5878 | 0 |
| Search “Expense 1” | 383 / 404 | 3031 / 3105 | 7541 / 7674 | 0 |
| Alerts | 92 / 92 | 782 / 803 | 1959 / 2078 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1820 ms in total (9 ms each on average).
Balances still add up to zero: yes ✓.