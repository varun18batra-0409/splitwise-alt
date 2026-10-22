# Load test

Seeded 400 people, 120 groups, 6187 expenses, 805 payments in 7 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 234 / 265 | 1802 / 1807 | 4186 / 4480 | 0 |
| Busy trip: activity | 156 / 161 | 1199 / 1231 | 3008 / 3144 | 0 |
| Busy trip: balances | 161 / 166 | 1167 / 1202 | 2941 / 3036 | 0 |
| Busy trip: charts | 155 / 163 | 1135 / 1139 | 2768 / 2944 | 0 |
| Busy trip: settle up | 140 / 143 | 988 / 1009 | 2445 / 2543 | 0 |
| Settle across groups | 214 / 224 | 1572 / 1578 | 3780 / 3837 | 0 |
| Search “Expense 1” | 263 / 281 | 2046 / 2125 | 4814 / 4965 | 0 |
| Alerts | 60 / 60 | 515 / 556 | 1263 / 1389 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1225 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.