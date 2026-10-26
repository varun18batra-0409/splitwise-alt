# Load test

Seeded 400 people, 120 groups, 6064 expenses, 845 payments in 11 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 342 / 347 | 2644 / 2785 | 6553 / 6877 | 0 |
| Busy trip: activity | 243 / 246 | 1914 / 2010 | 4713 / 4869 | 0 |
| Busy trip: balances | 235 / 250 | 1795 / 1873 | 4523 / 4559 | 0 |
| Busy trip: charts | 224 / 224 | 1763 / 1769 | 4478 / 4588 | 0 |
| Busy trip: settle up | 206 / 215 | 1575 / 1585 | 3871 / 4063 | 0 |
| Settle across groups | 318 / 320 | 2408 / 2446 | 5911 / 5971 | 0 |
| Search “Expense 1” | 409 / 441 | 3207 / 3227 | 8044 / 8125 | 0 |
| Alerts | 104 / 108 | 913 / 926 | 2248 / 2463 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1831 ms in total (9 ms each on average).
Balances still add up to zero: yes ✓.