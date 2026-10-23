# Load test

Seeded 400 people, 120 groups, 6155 expenses, 895 payments in 6 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 212 / 216 | 1618 / 1718 | 4035 / 4191 | 0 |
| Busy trip: activity | 153 / 156 | 1184 / 1187 | 2861 / 2977 | 0 |
| Busy trip: balances | 164 / 170 | 1106 / 1205 | 2703 / 2784 | 0 |
| Busy trip: charts | 145 / 145 | 1086 / 1152 | 2607 / 2753 | 0 |
| Busy trip: settle up | 126 / 128 | 965 / 992 | 2505 / 2588 | 0 |
| Settle across groups | 208 / 214 | 1499 / 1522 | 3801 / 3937 | 0 |
| Search “Expense 1” | 260 / 295 | 1899 / 2085 | 4903 / 4926 | 0 |
| Alerts | 61 / 69 | 537 / 645 | 1312 / 1371 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1204 ms in total (6 ms each on average).
Balances still add up to zero: yes ✓.