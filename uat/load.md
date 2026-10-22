# Load test

Seeded 400 people, 120 groups, 5929 expenses, 914 payments in 11 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 329 / 330 | 2593 / 2710 | 6482 / 6522 | 0 |
| Busy trip: activity | 248 / 249 | 1883 / 1910 | 4641 / 4739 | 0 |
| Busy trip: balances | 223 / 243 | 1777 / 1803 | 4344 / 4470 | 0 |
| Busy trip: charts | 225 / 227 | 1737 / 1811 | 4231 / 4434 | 0 |
| Busy trip: settle up | 202 / 202 | 1550 / 1607 | 3827 / 3922 | 0 |
| Settle across groups | 302 / 316 | 2306 / 2325 | 5769 / 5799 | 0 |
| Search “Expense 1” | 388 / 408 | 3100 / 3149 | 7701 / 7772 | 0 |
| Alerts | 104 / 107 | 866 / 875 | 2173 / 2287 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1866 ms in total (9 ms each on average).
Balances still add up to zero: yes ✓.