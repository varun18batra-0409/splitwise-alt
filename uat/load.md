# Load test

Seeded 400 people, 120 groups, 6113 expenses, 868 payments in 11 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 362 / 373 | 2740 / 2961 | 6884 / 6986 | 0 |
| Busy trip: activity | 248 / 253 | 1909 / 1918 | 4660 / 4719 | 0 |
| Busy trip: balances | 240 / 246 | 1784 / 1865 | 4435 / 4546 | 0 |
| Busy trip: charts | 236 / 237 | 1772 / 1839 | 4283 / 4442 | 0 |
| Busy trip: settle up | 210 / 217 | 1558 / 1670 | 3883 / 3900 | 0 |
| Settle across groups | 337 / 337 | 2518 / 2548 | 6053 / 6094 | 0 |
| Search “Expense 1” | 418 / 423 | 3288 / 3333 | 8032 / 8116 | 0 |
| Alerts | 96 / 97 | 850 / 862 | 2042 / 2235 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1857 ms in total (9 ms each on average).
Balances still add up to zero: yes ✓.