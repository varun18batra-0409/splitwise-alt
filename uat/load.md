# Load test

Seeded 400 people, 120 groups, 5898 expenses, 873 payments in 9 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 203 / 206 | 1478 / 1639 | 3849 / 3905 | 0 |
| Busy trip: activity | 158 / 166 | 1135 / 1142 | 2880 / 3118 | 0 |
| Busy trip: balances | 154 / 169 | 1128 / 1176 | 2791 / 2867 | 0 |
| Busy trip: charts | 143 / 145 | 1065 / 1089 | 2649 / 2915 | 0 |
| Busy trip: settle up | 156 / 164 | 1070 / 1082 | 2476 / 2540 | 0 |
| Settle across groups | 200 / 222 | 1486 / 1506 | 3672 / 3679 | 0 |
| Search “Expense 1” | 238 / 254 | 1895 / 1930 | 4464 / 4671 | 0 |
| Alerts | 43 / 48 | 280 / 283 | 679 / 749 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1758 ms in total (9 ms each on average).
Balances still add up to zero: yes ✓.