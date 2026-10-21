# Load test

Seeded 400 people, 120 groups, 6230 expenses, 900 payments in 12 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 338 / 343 | 2634 / 2768 | 6650 / 6667 | 0 |
| Busy trip: activity | 244 / 248 | 1915 / 1968 | 4688 / 4820 | 0 |
| Busy trip: balances | 235 / 261 | 1800 / 1885 | 4460 / 4596 | 0 |
| Busy trip: charts | 235 / 236 | 1766 / 1781 | 4338 / 4502 | 0 |
| Busy trip: settle up | 205 / 207 | 1577 / 1650 | 3944 / 3998 | 0 |
| Settle across groups | 309 / 312 | 2354 / 2478 | 5847 / 5868 | 0 |
| Search “Expense 1” | 365 / 391 | 2982 / 2994 | 7372 / 7404 | 0 |
| Alerts | 98 / 105 | 853 / 865 | 2156 / 2231 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1910 ms in total (10 ms each on average).
Balances still add up to zero: yes ✓.