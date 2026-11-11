# Load test

Seeded 400 people, 120 groups, 5624 expenses, 876 payments in 10 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 328 / 328 | 2560 / 2726 | 6324 / 6426 | 0 |
| Busy trip: activity | 262 / 283 | 1972 / 2114 | 4836 / 4999 | 0 |
| Busy trip: balances | 518 / 520 | 4715 / 4727 | 11756 / 13140 | 0 |
| Busy trip: charts | 245 / 250 | 1944 / 2128 | 4742 / 4886 | 0 |
| Busy trip: settle up | 210 / 214 | 1625 / 1632 | 3978 / 4086 | 0 |
| Settle across groups | 311 / 354 | 2296 / 2375 | 5749 / 5821 | 0 |
| Search “Expense 1” | 395 / 409 | 3090 / 3163 | 7582 / 7718 | 0 |
| Alerts | 107 / 108 | 931 / 949 | 2370 / 2446 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2468 ms in total (12 ms each on average).
Balances still add up to zero: yes ✓.