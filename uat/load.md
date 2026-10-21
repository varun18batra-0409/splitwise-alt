# Load test

Seeded 400 people, 120 groups, 5757 expenses, 907 payments in 10 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 335 / 335 | 2637 / 2689 | 6605 / 6700 | 0 |
| Busy trip: activity | 249 / 250 | 1850 / 1862 | 4655 / 4685 | 0 |
| Busy trip: balances | 225 / 250 | 1742 / 1746 | 4426 / 4578 | 0 |
| Busy trip: charts | 233 / 235 | 1759 / 1784 | 4378 / 4418 | 0 |
| Busy trip: settle up | 209 / 209 | 1574 / 1674 | 3988 / 4046 | 0 |
| Settle across groups | 329 / 335 | 2483 / 2534 | 6067 / 6084 | 0 |
| Search “Expense 1” | 405 / 415 | 3122 / 3186 | 7667 / 7720 | 0 |
| Alerts | 100 / 104 | 895 / 906 | 2233 / 2311 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1913 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.