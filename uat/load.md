# Load test

Seeded 400 people, 120 groups, 6121 expenses, 845 payments in 7 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 234 / 239 | 1715 / 1761 | 4327 / 4343 | 0 |
| Busy trip: activity | 158 / 161 | 1185 / 1230 | 2923 / 2978 | 0 |
| Busy trip: balances | 160 / 175 | 1129 / 1146 | 2879 / 2887 | 0 |
| Busy trip: charts | 149 / 150 | 1116 / 1216 | 2653 / 2701 | 0 |
| Busy trip: settle up | 148 / 149 | 1069 / 1098 | 2533 / 2622 | 0 |
| Settle across groups | 222 / 225 | 1633 / 1653 | 4079 / 4099 | 0 |
| Search “Expense 1” | 270 / 279 | 2018 / 2079 | 5031 / 5056 | 0 |
| Alerts | 39 / 40 | 304 / 318 | 744 / 755 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1541 ms in total (8 ms each on average).
Balances still add up to zero: yes ✓.