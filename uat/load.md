# Load test

Seeded 400 people, 120 groups, 6149 expenses, 893 payments in 7 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 231 / 236 | 1727 / 1800 | 4394 / 4567 | 0 |
| Busy trip: activity | 153 / 155 | 1127 / 1175 | 2951 / 3099 | 0 |
| Busy trip: balances | 139 / 156 | 1096 / 1152 | 2734 / 2764 | 0 |
| Busy trip: charts | 146 / 146 | 1122 / 1179 | 2724 / 2772 | 0 |
| Busy trip: settle up | 127 / 128 | 942 / 1010 | 2303 / 2450 | 0 |
| Settle across groups | 205 / 230 | 1573 / 1662 | 3833 / 3847 | 0 |
| Search “Expense 1” | 246 / 251 | 1831 / 1903 | 4732 / 4747 | 0 |
| Alerts | 61 / 63 | 458 / 516 | 1222 / 1259 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1430 ms in total (7 ms each on average).
Balances still add up to zero: yes ✓.