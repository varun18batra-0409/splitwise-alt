# Load test

Seeded 400 people, 120 groups, 6107 expenses, 939 payments in 11 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 266 / 269 | 2029 / 2074 | 5180 / 5211 | 0 |
| Busy trip: activity | 186 / 187 | 1431 / 1534 | 3447 / 3513 | 0 |
| Busy trip: balances | 178 / 201 | 1349 / 1397 | 3382 / 3392 | 0 |
| Busy trip: charts | 176 / 177 | 1228 / 1236 | 3063 / 3090 | 0 |
| Busy trip: settle up | 153 / 154 | 1202 / 1206 | 2962 / 3063 | 0 |
| Settle across groups | 266 / 268 | 1888 / 1898 | 4735 / 4815 | 0 |
| Search “Expense 1” | 308 / 312 | 2339 / 2375 | 5924 / 5960 | 0 |
| Alerts | 47 / 56 | 359 / 364 | 933 / 1118 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 3370 ms in total (17 ms each on average).
Balances still add up to zero: yes ✓.