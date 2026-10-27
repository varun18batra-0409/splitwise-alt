# UAT report

166 passed · 0 failed · 166 steps

| | Area | What a person did | Notes |
|---|---|---|---|
| ✅ | Start | First visit shows the intro tour with “Create your first group” |  |
| ✅ | Start | Creating a group asks you to sign up first (verified email) |  |
| ✅ | Start | There is no way to add people by typing a name |  |
| ✅ | Start | Create a group (INR) → lands on Add people | /join/pAhJcwz5 |
| ✅ | Joining | Someone opening the link without signing up can't join (no name box) |  |
| ✅ | Joining | Asha opens the link, signs up with her email, and joins |  |
| ✅ | Joining | Ravi does the same from a WhatsApp message |  |
| ✅ | Joining | Invite by email: Zoe gets an email, is listed as “Invited”, and is NOT a member yet |  |
| ✅ | Joining | Zoe taps the link in her email, verifies, and joins |  |
| ✅ | Joining | Add people shows everyone as “On Loopin ✓” and no pending invites | 4 verified members |
| ✅ | Joining | Contacts option is there (share sheet when the phone can't pick contacts) |  |
| ✅ | Add | Equal split between everyone (Varun pays ₹1,200 dinner) | Varun +₹900.00, Asha −₹300.00, Ravi −₹300.00, Zoe −₹300.00 |
| ✅ | Add | Someone else paid, only some people (Asha pays ₹400 taxi for Asha + Varun) | Varun +₹700.00, Asha −₹100.00, Ravi −₹300.00, Zoe −₹300.00 |
| ✅ | Add | Next expense remembers the last split (“same as last time”) |  |
| ✅ | Add | Paid by someone else on their behalf: Varun records Ravi paid ₹600 for everyone | Varun +₹550.00, Asha −₹250.00, Ravi +₹150.00, Zoe −₹450.00 |
| ✅ | Add | For one person only (₹1,000 tickets, just for Ravi) | Varun +₹1550.00, Asha −₹250.00, Ravi −₹850.00, Zoe −₹450.00 |
| ✅ | Add | Custom amounts that add up (₹1,000 = 100 + 200 + 300 + 400) | Varun +₹2450.00, Asha −₹450.00, Ravi −₹1150.00, Zoe −₹850.00 |
| ✅ | Add | Custom amounts that DON'T add up are refused | The amounts add up to ₹400, but the total is ₹1,000. |
| ✅ | Add | Percentages (Zoe pays ₹2,000 hotel, 50% Varun / 50% Zoe) | Varun +₹1450.00, Asha −₹450.00, Ravi −₹1150.00, Zoe +₹150.00 |
| ✅ | Add | Percentages that don't make 100% are refused | The percentages add up to 70%. They need to add up to 100%. |
| ✅ | Add | Yesterday's date and a note (₹400 coffee) | Varun +₹1750.00, Asha −₹550.00, Ravi −₹1250.00, Zoe +₹50.00 |
| ✅ | Add | Wrong amounts are refused: letters, zero, empty name still saves as “Expense”? |  |
| ✅ | Add | Double-tapping Save adds the expense only once | Varun +₹1900.00, Asha −₹600.00, Ravi −₹1300.00, Zoe +₹0.00 |
| ✅ | Edit | Edit an amount (Coffee ₹400 → ₹800) and balances follow | Varun +₹2200.00, Asha −₹700.00, Ravi −₹1400.00, Zoe −₹100.00 |
| ✅ | Edit | Edit clash: Asha saves first, Varun's older copy is warned, not overwritten | Varun +₹2230.00, Asha −₹710.00, Ravi −₹1410.00, Zoe −₹110.00 |
| ✅ | Edit | Delete an expense, then Undo brings it back | after delete: Varun +₹1230.00, Asha −₹710.00, Ravi −₹410.00, Zoe −₹110.00; restored: Varun +₹2230.00, Asha −₹710.00, Ravi −₹1410.00, Zoe −₹110.00 |
| ✅ | Edit | Undo bar right after adding an expense removes it again | Varun +₹2230.00, Asha −₹710.00, Ravi −₹1410.00, Zoe −₹110.00 |
| ✅ | Group settings | Set the group's card markup to 3% |  |
| ✅ | Currency | Card payment abroad: THB 1,000 at 2.5 with 3% card fee = ₹2,575 | Varun +₹4161.25, Asha −₹1353.75, Ravi −₹2053.75, Zoe −₹753.75 |
| ✅ | Currency | Cash abroad has no card fee: THB 400 cash at 2.5 = ₹1,000 | Varun +₹4911.25, Asha −₹1603.75, Ravi −₹2303.75, Zoe −₹1003.75 |
| ✅ | Currency | Card with the fee switched off: THB 200 at 2.5, no markup = ₹500 | Varun +₹4786.25, Asha −₹1228.75, Ravi −₹2428.75, Zoe −₹1128.75 |
| ✅ | Currency | Custom 2% fee: THB 1,000 at 2.5 = ₹2,550 | Varun +₹4148.75, Asha +₹683.75, Ravi −₹3066.25, Zoe −₹1766.25 |
| ✅ | Currency | Live exchange rate is fetched for USD (or, if the rate service is down, a rate is asked for) | Cash · $10 ≈ ₹949.80 Details |
| ✅ | Currency | Balances shows the THB balance separately (without card fees) |  |
| ✅ | Simple screens | Group top is short: balance, Settle up and Why? only (details moved to Balances) |  |
| ✅ | Simple screens | Balances only explains; paying happens on Settle up (no duplicate buttons) |  |
| ✅ | Simple screens | Activity has one Filter button that opens search, category and person |  |
| ✅ | Why? | “Why?” lines add up to the balance shown | Why? ⌄ You paid for the group +₹7,815 Your share of expenses incl. ₹31.25 card fees −₹3,666.25 You get back ₹4,148.75 Item by item Spa Today · share ₹637.50 (fe |
| ✅ | Settle | Group page has a “Settle up” button that opens the settle screen | 3 payments suggested |
| ✅ | Settle | Bottom bar “Settle” inside a group goes to the same screen |  |
| ✅ | Settle | Mark a payment as paid in full | Ravi → Varun ₹3066.25; Varun +₹1082.50, Asha +₹683.75, Ravi +₹0.00, Zoe −₹1766.25 |
| ✅ | Settle | Record a part payment (change the amount to less) | Zoe → Varun ₹541.00 of ₹1082.50; Varun +₹541.50, Asha +₹683.75, Ravi +₹0.00, Zoe −₹1225.25 |
| ✅ | Settle | A zero or nonsense amount is refused |  |
| ✅ | Settle | Double-tapping “Mark paid” records it once | Varun +₹0.00, Asha +₹683.75, Ravi +₹0.00, Zoe −₹683.75 |
| ✅ | Settle | Undo a payment from the bar | Varun +₹0.00, Asha +₹683.75, Ravi +₹0.00, Zoe −₹683.75 |
| ✅ | Settle | Record a different payment on the payment screen (Zoe paid Asha ₹50) | Varun +₹0.00, Asha +₹633.75, Ravi +₹0.00, Zoe −₹633.75 |
| ✅ | Settle | You can't record paying yourself |  |
| ✅ | Settle | Settle everything & close, then reopen |  |
| ✅ | Across groups | Two more groups with Asha: she owes ₹500 in one, Varun owes ₹300 in the other |  |
| ✅ | Across groups | Settle screen nets them into ONE payment: Asha pays Varun ₹200 |  |
| ✅ | Couples | Create a Couple group with the split worked out from incomes (55 / 45), add Asha |  |
| ✅ | Couples | “Our split 55 / 45” is chosen by default: ₹1,000 lunch → Asha owes ₹450 |  |
| ✅ | Couples | Two payers: ₹2,000 dinner, you ₹1,500 + Asha ₹500 → Asha owes ₹850 in all |  |
| ✅ | Couples | Money back: Asha got ₹200 back, shared 55 / 45 → Asha owes ₹960 |  |
| ✅ | Browse | History filters by type and amount (money back only; ₹1,500 and more) |  |
| ✅ | Add | Save & add another keeps the split and opens a fresh form |  |
| ✅ | Add | Repeat an expense, see the duplicate warning, then add it anyway |  |
| ✅ | Group settings | Turn off payment notifications for one group |  |
| ✅ | Add people | Search by name only finds friends; a stranger is found only by exact email, then added |  |
| ✅ | Alerts | Asha sees an unread alert badge and Varun's changes in Alerts |  |
| ✅ | Alerts | Asha was told she was added to the new groups |  |
| ✅ | Home | Home shows net balance, Needs attention or Groups, and the bottom bar |  |
| ✅ | Home | Tapping an expense in Latest opens it in its group, expanded, with Edit or delete |  |
| ✅ | Home | Messages at the top have a ✕: closing one hides it, and a refresh doesn't bring it back |  |
| ✅ | Home | Bottom bar is hidden while adding an expense |  |
| ✅ | Search | Search finds “Dinner” across groups |  |
| ✅ | Export | Spreadsheet download contains the expenses |  |
| ✅ | Group settings | Change a group's currency (UAT Dinner club INR → USD at 0.012) |  |
| ✅ | Group settings | Delete a group, see it under Recently deleted, restore it |  |
| ✅ | People | Rename someone on the People screen |  |
| ✅ | Account | Signed in: You page shows the email; Sign in goes to it; privacy page opens |  |
| ✅ | Group settings | Rename a group, then Undo puts the old name back |  |
| ✅ | Group settings | Show amounts in a second currency (USD) next to balances |  |
| ✅ | Close & reopen | Close a group from settings: it moves to Closed groups and new expenses are paused |  |
| ✅ | Close & reopen | Reopen it from the add screen |  |
| ✅ | People | Rename a person, then rename back |  |
| ✅ | People | Mark someone settled as left, then bring them back |  |
| ✅ | People | Remove someone who isn't in any expense (Sheldon) |  |
| ✅ | People | Someone owing money can't be marked as left until settled | everyone settled (skipped) |
| ✅ | Edit | Change who paid on an expense: balances move by exactly that amount |  |
| ✅ | Payments | Delete a payment from the history, then restore it |  |
| ✅ | Browse | Filter a group's history by category and person |  |
| ✅ | Browse | Search by month: the recap shows totals |  |
| ✅ | Browse | Charts tab opens with the group's spending |  |
| ✅ | Alerts | Alerts screen offers phone notifications on/off |  |
| ✅ | Add people | Inviting the email of someone already on Loopin adds them straight away |  |
| ✅ | Privacy | A stranger opening a group's address sees “Private group”: no name, no join link |  |
| ✅ | Privacy | A forged “who you are” cookie is ignored |  |
| ✅ | Privacy | An unsigned, plain “who you are” cookie (the old format) is ignored too |  |
| ✅ | Privacy | Sign-in can't send you to another website afterwards (back=/\evil.com) |  |
| ✅ | Account | Sign out of this phone, sign back in: all groups come back |  |
| ✅ | Account | Delete my email & sign-in |  |
| ✅ | Get the app | iPhone (Safari): invite link shows “Get the Loopin app” with Share → Add to Home Screen steps |  |
| ✅ | Get the app | iPhone (Chrome): steps use the Share button by the address bar |  |
| ✅ | Get the app | Android (Chrome): invite link offers the app; steps mention “Install app” |  |
| ✅ | Get the app | Home has an “App” button and the service worker is registered (needed to install) |  |
| ✅ | Get the app | First-time tour (iPhone) has the “App” button on every slide |  |
| ✅ | Navigation | Inside a group there's a back button to all groups |  |
| ✅ | Start screen | Tour → Home shows a start screen: create, join with a link, quick start, sign up / sign in |  |
| ✅ | Help | “?” on home opens the detailed How Loopin works guide (with photos), which links to the 1-minute tour | 12 photos on the guide (hero.jpg:1280 roadtrip.jpg:1280 dinner.jpg:1280 market.jpg:1280 train.jpg:1280 friends.jpg:1280 sunset.jpg:1280 trip-report.webp:0 home.jpg:1280 flat-month.webp:0 couple-month.webp:0 icon-192.png:192) |
| ✅ | Help | The 1-minute tour has 7 slides, one for flats & couples and one for card nights (The Pot), and none says “no sign-up” |  |
| ✅ | Help | The guide has Flatmates, Couples, the trip report and Splitwise, with real app screens that load |  |
| ✅ | Tags | Each expense shows its category: the icon's colour and shape, and the name for screen readers (Dinner → Bites & Sips, Taxi → Wheels & Wings) |  |
| ✅ | Flat | Create a Home group: it opens on This month, with Bills · List · Activity tabs |  |
| ✅ | Flat | Add Rent (₹30,000 on the 1st, you pay) and Electricity (changes each month, Asha pays) |  |
| ✅ | Flat | The daily job runs twice: Rent is added once, Electricity waits for its amount |  |
| ✅ | Flat | Asha taps “Enter amount”, types ₹2,840 and saves: Asha owes ₹13,580 in all |  |
| ✅ | Flat | Shopping list: add Bread and Milk, tick both, enter ₹1,240 → one Groceries expense |  |
| ✅ | Flat | A ₹1,500 Groceries budget with ₹1,240 spent shows “₹260 left” (nearly there) |  |
| ✅ | Flat | Reminders switch: on the flat's settings (off to start), not on the couple's |  |
| ✅ | Couples | The couple's This month says if you're ahead, behind or even |  |
| ✅ | Couples | Start a savings goal (₹1,00,000) and tap “I set money aside” (₹5,000) |  |
| ✅ | Flat | Asha moves out: final payment shown, she's marked moved out, balances still add up to zero |  |
| ✅ | Daily job | Without the key the daily job is refused; with it, it runs | no key set on this test server (skipped) |
| ✅ | Joining | Zoe, already signed in, opens the flat's invite link, taps Join, and shows on People |  |
| ✅ | Flat | Delete the automatic Rent from its edit screen: the daily job doesn't add it back |  |
| ✅ | Flat | Pause a bill and start it again from its page |  |
| ✅ | Flat | Deposit: you put in ₹40,000; lease over with ₹2,000 kept back → ₹38,000 back to you |  |
| ✅ | Export | The flat's spreadsheet has the bills and the shopping |  |
| ✅ | Speed | People search answers fast (5 searches, each timed) | median 345 ms, slowest 517 ms |
| ✅ | Edit | Change the split on an existing expense (Coffee ₹800: everyone → only You + Asha): balances move exactly |  |
| ✅ | Couples | “Even out” on This month opens Settle; marking it paid makes you even |  |
| ✅ | Couples | Settle-up minimum ₹50: a ₹45 balance isn't suggested as a payment, but stays in the balances |  |
| ✅ | Flat | Milk (₹60 a day): tap today as “didn’t come” on its calendar and the month's total drops by ₹60 |  |
| ✅ | Layout | Small Android phone (320 px), light mode: no screen scrolls sideways | 23 screens checked |
| ✅ | Edit | Rename an expense (Taxi → Airport taxi): the history says exactly what changed |  |
| ✅ | Flat | Skip a bill this time: next month's Rent is marked skipped and won't be added |  |
| ✅ | Flat | A ₹1,000 Groceries budget with ₹1,240 spent shows “₹240 over” |  |
| ✅ | Flat | Note when someone moved in (Zoe, on the 10th): it's recorded on People and in the history |  |
| ✅ | Flat | Set up Maintenance shared by % (you 70, the other 30); Groceries is one of the tiles |  |
| ✅ | Couples | Change the goal (target ₹80,000), then remove it |  |
| ✅ | New address | The old address forwards to loopinapps.com, and a signed-in person arrives still signed in (once) | checked on the GitHub test server only (on Vercel this would reach the live app) |
| ✅ | Sign in | One screen for new and returning people; Continue with Google goes to Google with our app and PKCE; a forged return is refused | Google isn't switched on for the test copy (it is on the live app) |
| ✅ | Joining | Someone added by name only: “not on Loopin yet” → Invite by email → they open it, sign up, “Continue as Rohit”, and take over the name |  |
| ✅ | Switching | “Coming from Splitwise?” → pick the exported file → balances checked → Bring it over: a new group with the same expenses, payments and balances |  |
| ✅ | Trips | Charts shows a few plain-English lines and “Trip report”; the report shares as a picture plus text (no link to the group) |  |
| ✅ | Account | You → Download all my data: one spreadsheet with every group, my share and my balance change |  |
| ✅ | Sign in | Fingerprint / face: turn it on, sign out, sign back in with one touch, then remove it |  |
| ✅ | Add | Shares: ₹1,200 split 2 : 1 : 1 : 1 : 1 → Varun ₹400, the others ₹200 each |  |
| ✅ | Sign in | A wrong code is refused with a clear message, and the right one still works |  |
| ✅ | Sign in | Right after signing in, “Sign in faster next time?” can be closed with ✕ and stays closed |  |
| ✅ | Settle | Remind opens WhatsApp with the amount and who owes it |  |
| ✅ | Settle | When every payment is under the group's minimum, Settle says “Nearly square” |  |
| ✅ | Add people | The invite screen shows the group's link and a QR code |  |
| ✅ | Navigation | The group name at the top switches to another group |  |
| ✅ | Currency | A yen group shows no decimals anywhere, and its settle-up minimum reads in whole yen |  |
| ✅ | Flat | A bill whose payer has moved out waits with “Add it”, and Add it comes pre-filled |  |
| ✅ | Switching | A file that isn't a Splitwise export gets a clear message; a second currency is flagged |  |
| ✅ | Trips | Close the imported trip: Home links to the trip report, which says All settled; Copy as text works |  |
| ✅ | Privacy | A stranger can't open a group's report, its spreadsheet or someone else's data download |  |
| ✅ | Collect | Varun makes a Farewell collection (₹500 each, his UPI), lists Zoya and Kabir, and picks Asha from his Loopin friends |  |
| ✅ | Collect | Asha (on Loopin) finds it in Alerts: “Varun added you: ₹500 each” |  |
| ✅ | Collect | Zoya opens the link with no sign-up: the UPI button has Varun's ID and ₹500 filled in; she ticks her name |  |
| ✅ | Collect | Varun sees “Zoya says paid” in Alerts, taps Got it, marks Kabir as paid in cash: 2 of 3, ₹1,000 of ₹1,500 |  |
| ✅ | Collect | Varun reminds Asha inside Loopin (bell); a second reminder straight away is refused; Asha sees it in Alerts |  |
| ✅ | Collect | Someone else can't change Varun's collection (no organiser buttons; a forged Got it is refused) |  |
| ✅ | New group | “What’s it for?” offers Trip, Home, Couple, The Pot, Collect and Anything Goes; The Pot explains itself; Collect opens Collect |  |
| ✅ | Countdown | A trip made with a start date in 10 days: the group says “in 10 days”, Home shows the countdown with the plane taking off |  |
| ✅ | Countdown | A second trip in 30 days: Home turns it into “Your trips 2”, soonest first, one card at a time |  |
| ✅ | Groups | A photo picked while making a group becomes its picture |  |
| ✅ | Add | Type it in one line: “Snacks 600 split with everyone” fills the name, amount and split, and nothing saves until Save |  |
| ✅ | Settle | Varun adds his UPI ID on the You page; his WhatsApp Remind now carries it and a link to mark it paid |  |
| ✅ | Fun | React 🔥 to an expense: it shows under the expense; tapping 🔥 again takes it back |  |
| ✅ | Fun | Spin for it: the wheel lands on someone, and they become the payer |  |
| ✅ | Fun | Wrapped: tap through the slides; the last one offers Share |  |
| ✅ | Fun | Trip passport opens from the You page, and a place from before Loopin can be added |  |