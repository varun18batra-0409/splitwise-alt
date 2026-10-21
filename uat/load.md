# Load test

Seeded 400 people, 120 groups, 5890 expenses, 901 payments in 11 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 315 / 323 | 2428 / 2501 | 6017 / 6056 | 0 |
| Busy trip: activity | 237 / 238 | 1771 / 1819 | 4305 / 4342 | 0 |
| Busy trip: balances | 233 / 251 | 1669 / 1718 | 4194 / 4229 | 0 |
| Busy trip: charts | 227 / 236 | 1667 / 1775 | 4060 / 4085 | 0 |
| Busy trip: settle up | 203 / 203 | 1504 / 1531 | 3653 / 3671 | 0 |
| Settle across groups | 306 / 307 | 2191 / 2234 | 5483 / 5496 | 0 |
| Search “Expense 1” | 363 / 396 | 2708 / 2771 | 6703 / 6724 | 0 |
| Alerts | 92 / 98 | 780 / 799 | 1977 / 2040 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1983 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.