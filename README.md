# Split — a simple Splitwise alternative

A mobile-first web app for splitting expenses with friends. No accounts, no real money.

## Open it from your phone (GitHub Codespaces)

1. On this repo's GitHub page, tap the green **Code** button.
2. Choose the **Codespaces** tab, then **Create codespace on main**.
3. Wait a few minutes the first time while it installs everything.
4. When the app starts, a new tab opens showing it. If it doesn't, open the
   **Ports** tab at the bottom and tap the link next to port **3000**.
5. When you're done, stop the codespace (github.com/codespaces) so it doesn't use up free hours.

## Run it on a computer

```
npm install        # downloads the tools the app needs
npm run db:setup   # creates the database file
npm run dev        # starts the app at http://localhost:3000
npm test           # checks the money math
```

## How money is stored

All amounts are whole paise (₹12.50 = 1250), so rounding errors can't happen.
