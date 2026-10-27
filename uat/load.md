# Load test

Seeded 400 people, 120 groups, 6396 expenses, 812 payments in 11 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 339 / 354 | 2687 / 2757 | 6865 / 6985 | 0 |
| Busy trip: activity | 263 / 264 | 1943 / 1951 | 4832 / 5057 | 0 |
| Busy trip: balances | 399 / 409 | 3620 / 3750 | 8517 / 8923 | 0 |
| Busy trip: charts | 225 / 232 | 1777 / 1785 | 4450 / 5372 | 0 |
| Busy trip: settle up | 206 / 206 | 1571 / 1583 | 3932 / 4029 | 0 |
| Settle across groups | 325 / 325 | 2477 / 2563 | 6213 / 6251 | 0 |
| Search “Expense 1” | 411 / 438 | 3294 / 3303 | 8239 / 8302 | 0 |
| Alerts | 101 / 106 | 877 / 886 | 2199 / 2278 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 1724 ms in total (9 ms each on average).
Balances still add up to zero: yes ✓.