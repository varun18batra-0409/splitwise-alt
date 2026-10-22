# Load test

Seeded 400 people, 120 groups, 5847 expenses, 873 payments in 11 s.
Heavy user: in 20 groups. Busy trip: 1,200 expenses, 300 payments, 12 people.

## Opening screens (milliseconds; median / 95th percentile)

| Screen | 1 person | 10 at once | 25 at once | Errors |
|---|---|---|---|---|
| Home | 365 / 376 | 2890 / 2970 | 7259 / 7379 | 0 |
| Busy trip: activity | 264 / 265 | 2013 / 2050 | 5042 / 5186 | 0 |
| Busy trip: balances | 248 / 278 | 1892 / 1967 | 4665 / 4723 | 0 |
| Busy trip: charts | 237 / 244 | 1876 / 1902 | 4567 / 4728 | 0 |
| Busy trip: settle up | 216 / 227 | 1634 / 1726 | 4085 / 4227 | 0 |
| Settle across groups | 347 / 373 | 2562 / 2607 | 6386 / 6429 | 0 |
| Search “Expense 1” | 431 / 444 | 3393 / 3484 | 8438 / 8493 | 0 |
| Alerts | 107 / 107 | 932 / 945 | 2405 / 2466 | 0 |

## Saving at the same time
200 expenses from 12 people at once: 200 saved OK, 200 in the database, 2220 ms in total (11 ms each on average).
Balances still add up to zero: yes ✓.