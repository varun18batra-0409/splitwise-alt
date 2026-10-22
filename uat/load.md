# Load test

Seeded 400 people, 120 groups, 6296 expenses, 823 payments in 10 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 284 / 287 | 2065 / 2219 | 4907 / 5041 | 0 |
| Busy trip: activity | 168 / 178 | 1291 / 1307 | 3214 / 3226 | 0 |
| Busy trip: balances | 164 / 192 | 1276 / 1346 | 3087 / 3165 | 0 |
| Busy trip: charts | 164 / 166 | 1258 / 1293 | 3051 / 3101 | 0 |
| Busy trip: settle up | 153 / 159 | 1082 / 1129 | 2741 / 2782 | 0 |
| Settle across groups | 244 / 247 | 1735 / 1830 | 4309 / 4347 | 0 |
| Search “Expense 1” | 305 / 336 | 2354 / 2417 | 5560 / 5715 | 0 |
| Alerts | 71 / 71 | 585 / 604 | 1446 / 1533 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1506 ms in total (8 ms each on average).
Balances still add up to zero: yes ✓.