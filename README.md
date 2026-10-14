# Split — a simple Splitwise alternative

A phone-first web app for splitting expenses with friends. No accounts, no ads,
and it never holds or moves real money: it only keeps track of who owes whom.

## What it does

- **Groups.** Create a group, share an invite link (or pick people from your
  phone's contacts), and friends join by tapping their name. Close a group
  when the trip is over; reopen it any time.
- **Expenses.** Name, amount, date and who paid. Split equally, by exact
  amounts or by percent, between everyone, some people or one person.
  The category (food, travel, stay…) is guessed from the name, and typos get
  a "Did you mean…" fix.
- **Foreign currency.** Add an expense in any of ~160 currencies. Live
  exchange rates (Frankfurter, free) with a manual fallback, plus an
  optional card markup. Balances are also shown in the foreign currency,
  without markup.
- **Smart Settle.** The fewest payments that clear everything, inside each
  group, per person, and across groups when the same people share several.
- **Record a payment.** Any amount between any two people, full or part.
- **History, undo and notifications.** Anyone in the group can edit or
  delete anything. Every change is kept in the history, can be undone or
  restored, and shows up in everyone else's bell.
- **People.** Rename anyone, remove someone added by mistake, or leave a
  group once you're settled up (you stay in the history).
- **Search and filter** the history by words, category or person.
- **Charts.** Spending by category, currency, day and person.
- **Download** a group as a spreadsheet (CSV) for Excel or Google Sheets.
- **Install it like an app**: Chrome's "Install app" / "Add to Home screen".

## Open it from your phone (GitHub Codespaces)

1. Go to github.com/codespaces and open this repo's codespace (or, on the repo
   page, tap **Code → Codespaces → Create codespace on main**).
2. It updates and starts the app by itself. When the app opens, it's ready.
3. To get the newest version in an open codespace, type this in the terminal:

   ```
   pkill -f "next dev"; git pull && npm install && npm run share; npm run dev
   ```

4. **Invite links** only work for friends when port 3000 is public.
   `npm run share` does that; or open the **Ports** tab, long-press port
   3000 → **Port visibility → Public**.
5. When you're done, stop the codespace so it doesn't use up free hours.

## Checks on every update

Each push to GitHub runs all the tests, builds the app, and takes phone-sized
pictures of every screen (saved on the `screenshots` branch).

## Run it on a computer

```
npm install        # downloads the tools the app needs
npm run db:setup   # creates or updates the database file
npm run dev        # starts the app at http://localhost:3000
npm test           # runs the tests
```

## How money is stored

All amounts are whole minor units (₹12.50 = 1250 paise; yen has none, dinar
has three), so rounding errors can't happen. Splits hand out leftover paise
fairly, and every exchange rate used is saved with the expense.
