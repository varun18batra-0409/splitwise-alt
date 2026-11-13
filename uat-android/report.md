# UAT report

Profile: **android**: Android phone: Chromium, 390×844, touch, en-IN, Asia/Kolkata

216 passed · 4 failed · 4 not applicable · 3 not run · 227 steps

| | Area | What a person did | Notes |
|---|---|---|---|
| ✅ | Start | First visit shows the intro tour with “Create your first group” |  |
| ✅ | Start | Creating a group asks you to sign up first (verified email) |  |
| ✅ | Start | There is no way to add people by typing a name |  |
| ✅ | Start | Create a group (INR) → lands on Add people | /join/_RX3_Mdv |
| ✅ | Joining | Someone opening the link without signing up can't join (no name box) |  |
| ✅ | Joining | Asha opens the link, signs up with her email, and joins |  |
| ✅ | Joining | Ravi does the same from a WhatsApp message |  |
| ✅ | Joining | Only Varun, who started the group, can delete it, change its currency or remove people: Asha sees a calm note instead |  |
| ✅ | Joining | Add by email: Zoe is in the group at once as a name (“Invited · hasn’t joined yet”) and gets an invitation email |  |
| ✅ | Joining | Zoe taps the link in her email, verifies, and joins as the name she was added with |  |
| ✅ | Joining | Invite emails carry an unsubscribe link: one tap stops them, and the next invite to that address isn't sent |  |
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
| ✅ | Currency | Live exchange rate is fetched for USD (or, if the rate service is down, a rate is asked for) | ≈ ₹939.90, Cash, no card fee |
| ✅ | Currency | Balances shows the THB balance separately (without card fees) |  |
| ✅ | Simple screens | Group top is short: balance, Settle up and Why? only (details moved to Balances) |  |
| ✅ | Simple screens | Balances only explains; paying happens on Settle up (no duplicate buttons) |  |
| ✅ | Simple screens | Activity has one Filter button that opens search, category and person |  |
| ✅ | Why? | “Why?” lines add up to the balance shown | Why? ⌄ You paid for the group +₹7,815 Your share of expenses incl. ₹31.25 card fees −₹3,666.25 You get back ₹4,148.75 Item by item Spa Today · share ₹637.50 (fe |
| ✅ | Settle | Group page has a “Settle up” button that opens the settle screen | 3 payments suggested |
| ✅ | Settle | Bottom bar “Settle” inside a group goes to the same screen |  |
| ✅ | Settle | Mark a payment as paid in full | Ravi → Varun ₹3066.25; Varun +₹1082.50, Asha +₹683.75, Ravi +₹0.00, Zoe −₹1766.25 |
| ❌ | Settle | Record a part payment (change the amount to less) | page.waitForURL: Timeout 15000ms exceeded. =========================== logs =========================== waiting for navigation until "load" (screenshot: fail-01.png) |
| ❌ | Settle | A zero or nonsense amount is refused | locator.waitFor: Timeout 15000ms exceeded. Call log: - waiting for getByText(/more than zero/valid amount/) to be visible (screenshot: fail-02.png) |
| ❌ | Settle | Double-tapping Record payment records it once | balances differ: Varun shows ₹0.00 expected ₹1082.50; Zoe shows ₹0.00 expected ₹-1082.50 (screenshot: fail-03.png) |
| ⏭️ | Settle | Undo a payment from the bar | not run: nothing left to pay |
| ⏭️ | Settle | “I’ve paid” is only a claim: balances don't move until Asha taps Confirm received | not run: Varun pays nobody who has joined right now |
| ❌ | Settle | Record a different payment on the payment screen (Zoe paid Asha ₹50) | page.waitForURL: Timeout 15000ms exceeded. =========================== logs =========================== waiting for navigation until "load" [browser errors: console Blocked call to navigator.vibrate because user hasn't tapped on the frame or any embedded frame yet: https://www.chromestatus.com/feature/56442738610012] (screenshot: fail-04.png) |
| ✅ | Settle | Paying more than owed (an extra zero) asks first and saves nothing until confirmed |  |
| ✅ | Settle | You can't record paying yourself |  |
| ✅ | Settle | Settle everything & close, then reopen |  |
| ✅ | Across groups | Two more groups with Asha: she owes ₹500 in one, Varun owes ₹300 in the other |  |
| ✅ | Across groups | Settle screen nets them into ONE payment: Asha pays Varun ₹200 |  |
| ✅ | Across groups | All square page: a “Hide amounts” switch swaps the money tile for counts, and the shared picture follows |  |
| ✅ | Couples | Create a Couple group with the split worked out from incomes (55 / 45), add Asha |  |
| ✅ | Couples | “Our split 55 / 45” is chosen by default: ₹1,000 lunch → Asha owes ₹450 |  |
| ✅ | Couples | Two payers: ₹2,000 dinner, you ₹1,500 + Asha ₹500 → Asha owes ₹850 in all |  |
| ✅ | Couples | Money back: Asha got ₹200 back, shared 55 / 45 → Asha owes ₹960 |  |
| ✅ | Browse | History filters by type and amount (money back only; ₹1,500 and more) |  |
| ✅ | Add | Save & add another keeps the split and opens a fresh form |  |
| ✅ | Add | Repeat an expense, see the duplicate warning, then add it anyway |  |
| ✅ | Group settings | Turn off payment notifications for one group |  |
| ✅ | Add people | Search by name only finds friends; a full email gets the same neutral Add (no account revealed) and puts a stranger who is on Loopin in the group as an invited name |  |
| ✅ | Alerts | Asha sees an unread alert badge and Varun's changes in Alerts |  |
| ✅ | Alerts | Asha was told she was added to the new groups |  |
| ✅ | Home | Home opens on the boarding-pass money card (route, one amount, ONE cream button; no tint, no “Add expense”, no repeated amount), a quiet line under it for what needs you, then Your groups and the bottom bar, which keeps its “+” |  |
| ✅ | Home | On a small phone (375×667) the header, the boarding-pass card (one-amount ticket at most about 200px tall, both-ways about 260px) and its buttons (44px tall) sit inside the first screen above the bottom bar, the Your groups row starts above the bottom bar, and the next polaroid peeks in; the bottom bar's + goes to the group picker or the only group |  |
| ✅ | Home | Home lists each group once: polaroid cards only (no old vertical list, no “Show all N groups”), each open group on one card, and the stories row is absent when there are no stories |  |
| ✅ | Home | F6/F10/F19: FAQ, Privacy and Terms on Home each have a 44px tap area with space between them; Latest says “Payment”, never “Settle-up”; the You page footer has a Privacy link with a 44px target |  |
| ✅ | Home | F5: an open story's full-screen photo is requested big and sharp (its image address asks for 1920px or wider, quality 90) |  |
| ✅ | Home | “+ New group” is the first card in Your groups (dashed, as tall as the polaroids, at least 44px), whatever the number of groups, and one tap opens the new-group page; “See all” stays in the header |  |
| ✅ | Home | Home order: Latest comes straight after Your groups (only the trip countdown may sit between); closed groups and Recently deleted are not on Home; the “saved on this phone” note is below everything but the footer |  |
| ✅ | Home | On the narrowest phone (320×640, also 360 and 390) the boarding-pass card has no sideways scroll: nothing is cut off, the amount always shows whole, the stub is 84px below 360px and 100px from 360px, the buttons keep their words inside, and the card has no tint |  |
| ✅ | Home | The bottom bar is nearly solid (background alpha 0.9 or more) so words never show through, and big amounts on Home are whole rupees |  |
| ✅ | Home | The sliding cards at the top: 4 to 7 of them, no two the same, each with words and a button that goes somewhere; no “Coming from another app?” card | Your month so far November in numbers ₹7,106 your share 18 e · Postcards Send a postcard A trip photo, a real-looking stamp · PASSPORT LOOPIN ARRIVED Your trip passport Where have you be · Nothing booked yet Where to next? Start a trip group now. Th |
| ✅ | Home | Tapping an expense in Latest opens it in its group, expanded, with Edit or delete |  |
| ✅ | Home | Messages at the top have a ✕: closing one hides it, and a refresh doesn't bring it back |  |
| ✅ | Home | Bottom bar is hidden while adding an expense |  |
| ✅ | Search | Search finds “Dinner” across groups |  |
| ✅ | Export | Spreadsheet download contains the expenses |  |
| ✅ | Group settings | Change a group's currency (UAT Dinner club INR → USD at 0.012) |  |
| ✅ | Group settings | Delete a group: it lands on Your groups with Recently deleted open (not on Home), You links to it, restore brings it back |  |
| ✅ | People | Rename someone on the People screen |  |
| ✅ | Account | Signed in: You page shows the email; Sign in goes to it; privacy page opens |  |
| ✅ | Group settings | Rename a group, then Undo puts the old name back |  |
| ✅ | Group settings | Show amounts in a second currency (USD) next to balances |  |
| ✅ | Close & reopen | Close a group from settings: it moves to Closed groups and new expenses are paused |  |
| ✅ | Close & reopen | Reopen it from the add screen |  |
| ✅ | People | Rename a person, then rename back |  |
| ✅ | People | Remove someone settled up (the admin removes; they show under Removed), then bring them back |  |
| ✅ | People | Remove someone who isn't in any expense (Sheldon) |  |
| ⏭️ | People | Someone owing money can't be marked as left until settled | not run: everyone settled |
| ✅ | Edit | Change who paid on an expense: balances move by exactly that amount |  |
| ✅ | Payments | Delete a payment from the history, then restore it |  |
| ✅ | Browse | Filter a group's history by category and person |  |
| ✅ | Browse | Search by month: the recap shows totals |  |
| ✅ | Browse | Charts tab opens with the group's spending |  |
| ✅ | Alerts | Alerts screen offers phone notifications on/off |  |
| ✅ | Alerts | Notifications & email: opens from You, an email switch persists after a reload, and with it off an add-to-group email isn't sent; switched back on it is |  |
| ✅ | Add people | Adding the email of someone already on Loopin gets the same reply as any email; they see an invitation on Home and in Alerts |  |
| ✅ | Privacy | A stranger opening a group's address sees “Private group”: no name, no join link |  |
| ✅ | Privacy | A forged “who you are” cookie is ignored |  |
| ✅ | Privacy | An unsigned, plain “who you are” cookie (the old format) is ignored too |  |
| ✅ | Privacy | Sign-in can't send you to another website afterwards (back=/\evil.com) |  |
| ✅ | Account | Sign out of this phone, sign back in: all groups come back |  |
| ✅ | Account | Delete my email & sign-in |  |
| ✅ | Get the app | iPhone (Safari): invite link shows “Get the Loopin app” with Share → Add to Home Screen steps |  |
| ✅ | Get the app | iPhone (Chrome): steps use the Share button by the address bar |  |
| ✅ | Get the app | Android (Chrome): invite link offers the app; steps mention “Install app” |  |
| ✅ | Sign in | UX-04: the sign-in header is short (about 96px) on a short phone (390×667) and tall on a normal one (390×844), so the small-phone variant works for both width and height |  |
| ✅ | Get the app | Home has an “App” button and the service worker is registered (needed to install) |  |
| ✅ | Get the app | First-time tour (iPhone) has the “App” button on every slide |  |
| ✅ | Navigation | Inside a group there's a back button to all groups |  |
| ✅ | Start screen | Tour → Home shows a start screen: create, join with a link, quick start, sign up / sign in |  |
| ✅ | Help | “?” on home opens the detailed How Loopin works guide (with photos), which links to the 1-minute tour | 24 photos on the guide (image?url=%2Fphotos%2Fhero.jpg&w=3840&q=75:390 image?url=%2Fphotos%2Froadtrip.jpg&w=3840&q=75:390 image?url=%2Fphotos%2Fdinner.jpg&w=3840&q=75:390 image?url=%2Fphotos%2Fmarket.jpg&w=3840&q=75:390 image?url=%2Fphotos%2Ffriends.jpg&w=3840&q=75:390 image?url=%2Fphotos%2Fsunset.jpg&w=3840&q=75:0 trip-report.webp:0 image?url=%2Fphotos%2Fhome.jpg&w=3840&q=75:0 flat-month.webp:0 couple-month.webp:0 image?url=%2Fphotos%2Fplace-goa.jpg&w=3840&q=75:0 story-trip.webp:0 story-pot.webp:0 image?url=%2Fphotos%2Fplace-bali-2.jpg&w=3840&q=75:0 wrapped-total.webp:0 wrapped-receipt.webp:0 image?url=%2Fphotos%2Fplace-santorini.jpg&w=3840&q=75:0 passport-stamps.webp:0 friends-passports.webp:0 image?url=%2Fphotos%2Fplace-goa-4.jpg&w=3840&q=75:0 image?url=%2Fphotos%2Fplace-japan-2.jpg&w=3840&q=75:0 spin.webp:0 titles.webp:0 icon-192.png:192) |
| ✅ | Help | The 1-minute tour has 6 slides (make a group, add what you paid, see who owes then settle, every trip becomes a story, send a postcard, collect your passport), in words that work outside India, and none says “no sign-up” |  |
| ✅ | Help | The tour moves like stories: tap the right side for next, the left side to go back, and Back / Next buttons at the bottom |  |
| ✅ | Help | The guide has Home, Couples, the trip report, stories, Wrapped, the passport and moving over from another app, with real app screens that load |  |
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
| ✅ | Flat | Delete the automatic Rent from its edit screen: the daily job doesn't add it back |  |
| ✅ | Flat | Asha moves out: final payment shown, she's marked moved out, balances still add up to zero |  |
| ✅ | Daily job | Without the key the daily job is refused; with it, it runs |  |
| ✅ | Joining | Zoe, already signed in, opens the flat's invite link, taps Join, and shows on People |  |
| ✅ | Flat | Pause a bill and start it again from its page |  |
| ✅ | Flat | Deposit: you put in ₹40,000; lease over with ₹2,000 kept back → ₹38,000 back to you |  |
| ✅ | Export | The flat's spreadsheet has the bills and the shopping |  |
| ✅ | Speed | People search answers fast (5 searches, each timed) | median 16 ms, slowest 107 ms |
| ✅ | Edit | Change the split on an existing expense (Coffee ₹800: everyone → only You + Asha): balances move exactly |  |
| ✅ | Couples | “Even out” on This month opens Settle; marking it paid makes you even |  |
| ✅ | Couples | Settle-up minimum ₹50: a ₹45 balance isn't suggested as a payment, but stays in the balances |  |
| ✅ | Flat | Milk (₹60 a day): tap today as “didn’t come” on its calendar and the month's total drops by ₹60 |  |
| ✅ | Layout | Small Android phone (320 px), light mode: no screen scrolls sideways | 23 screens checked in 9 s |
| ✅ | Layout | Sign-in on small phones (320×568 and 375×667): Google and the email box are both on the first screen, no scrolling | 320×568: email box ends at 366px; 375×667: email box ends at 366px |
| ✅ | Group settings | Settings has ONE Save; the group's currency is for the person who looks after it (Asha sees it as text, not a dropdown) |  |
| ✅ | Edit | Rename an expense (Taxi → Airport taxi): the history says exactly what changed |  |
| ✅ | Flat | Skip a bill this time: next month's Rent is marked skipped and won't be added |  |
| ✅ | Flat | A ₹1,000 Groceries budget with ₹1,240 spent shows “₹240 over” |  |
| ✅ | Flat | Note when someone moved in (Zoe, on the 10th): it's recorded on People and in the history |  |
| ✅ | Flat | Set up Maintenance shared by % (you 70, the other 30); Groceries is one of the tiles |  |
| ✅ | Couples | Change the goal (target ₹80,000), then remove it |  |
| ✅ | New address | The old address forwards to loopinapps.com, and a signed-in person arrives still signed in after one tap (once) |  |
| ✅ | Sign in | One screen for new and returning people; Continue with Google goes to Google with our app and PKCE; a forged return is refused |  |
| ✅ | Joining | Someone added by name only: “not on Loopin yet” → Invite by email → they open it, sign up, “Continue as Rohit”, and take over the name |  |
| ✅ | Switching | “Coming from another app?” → pick the exported file → balances checked → Bring it over: a new group with the same expenses, payments and balances |  |
| ✅ | Trips | Charts shows a few plain-English lines and “Trip report”; the report shares as a picture plus text (no link to the group) |  |
| ✅ | Account | You → Download all my data: one spreadsheet with every group, my share and my balance change |  |
| ✅ | Sign in | Fingerprint / face: turn it on, sign out, sign back in with one touch, then remove it |  |
| ✅ | Add | Shares: ₹1,200 split 2 : 1 : 1 : 1 : 1 → Varun ₹400, the others ₹200 each |  |
| ✅ | Add | Split by item: ₹1,180 bar bill, Pizza ₹600 for Varun and Asha, Beer ₹400 for Asha → tax and tip shared by what each had: Varun ₹354, Asha ₹826 |  |
| ✅ | Add | A bill photo stays with the expense: Asha can open it, and someone outside the group can't |  |
| ✅ | Add | Slow connection: Save shows Saving… and stays off; a second tap adds nothing; saved once |  |
| ✅ | Postcards | A postcard link that doesn't exist: signed in → 'This screen isn't here'; signed out → sign-in first |  |
| ✅ | Edit | Editing shows the bill photo already kept, with Replace and Remove; Remove takes it off when saved |  |
| ✅ | Sign in | A wrong code is refused with a clear message, and the right one still works |  |
| ✅ | Sign in | Right after signing in, “Sign in faster next time?” can be closed with ✕ and stays closed |  |
| ✅ | Settle | Remind opens WhatsApp with the amount and who owes it |  |
| ✅ | Settle | When every payment is under the group's minimum, Settle says “Nearly square” |  |
| ✅ | Add people | The invite screen shows the group's link and a QR code |  |
| ✅ | Navigation | The group name at the top switches to another group |  |
| ✅ | Currency | A yen group shows no decimals anywhere, and its settle-up minimum reads in whole yen |  |
| ✅ | Flat | A bill whose payer has moved out waits with “Add it”, and Add it comes pre-filled |  |
| ✅ | Switching | A file that isn't a known export gets a clear message; a second currency is flagged |  |
| ✅ | Trips | Close the imported trip: Home links to the trip report, which says All settled; Copy as text works |  |
| ✅ | Privacy | A stranger can't open a group's report, its spreadsheet or someone else's data download |  |
| ✅ | Collect | Varun makes a Farewell collection (₹500 each, his UPI), lists Zoya and Kabir, and picks Asha from his Loopin friends |  |
| ✅ | Collect | Asha (on Loopin) finds it in Alerts: “Varun added you: ₹500 each” |  |
| ✅ | Collect | Zoya opens the link with no sign-up: the UPI button has Varun's ID and ₹500 filled in; she ticks her name |  |
| ✅ | Collect | Varun sees “Zoya says paid” in Alerts, taps Got it, marks Kabir as paid in cash: 2 of 3, ₹1,000 of ₹1,500 |  |
| ✅ | Collect | Varun reminds Asha inside Loopin (bell); a second reminder straight away is refused; Asha sees it in Alerts |  |
| ✅ | Collect | Someone else can't change Varun's collection (no organiser buttons; a forged Got it is refused) |  |
| ✅ | New group | “What’s it for?” offers Trip, Home, Couple, Game night, Collect and Anything Goes; Game night explains itself; Collect opens Collect |  |
| ✅ | Countdown | A trip made with a start date in 10 days: the group says “in 10 days”, Home shows the countdown strip with the trip's picture |  |
| ✅ | Countdown | A second trip in 30 days: the soonest stays in the countdown strip under the money card, the later one shows under “Also coming up”, one card at a time |  |
| ✅ | Groups | A photo picked while making a group becomes its picture |  |
| ✅ | Add | Type it in one line: “Snacks 600 split with everyone” fills the name, amount and split, and nothing saves until Save |  |
| ✅ | Add | Add expense is tidy: the amount, the day under it, one What was it? field with Scan a bill · Speak · Type a line inside it, then two rows for who paid and the split; notes, several payers and Spin sit under a closed More link; the result for you is one quiet line under the card |  |
| ✅ | Add | Editing an expense that has notes opens More by itself, so nothing is hidden |  |
| ✅ | Words | No page says another app’s name: the tour, guide, FAQ, switching and import screens |  |
| ✅ | Words | Game night: none of poker, teen patti, buy-in, cash out, winnings or bet appears on the group-type chips, the game screens, the FAQ or How Loopin works; the calm line is on the game screen |  |
| ✅ | Words | The import screen gives generic export steps and no other app’s name |  |
| ✅ | Settle | Varun adds his UPI ID on the You page; his WhatsApp Remind carries it and an “I’ve paid” link that opens without signing in |  |
| ➖ | Settle | Outside India: the You page has no UPI box; Varun saves a PayPal link and the “I’ve paid” page offers PayPal | not applicable on android: this is the outside-India path (PayPal, Venmo, Revolut, Monzo); in India the UPI step above runs instead (runs on desktop) |
| ✅ | Fun | React 🔥 to an expense: it shows under the expense; tapping 🔥 again takes it back |  |
| ✅ | Fun | Spin for it: the wheel lands on someone, and they become the payer |  |
| ✅ | Fun | Wrapped: tap through the slides; the last one offers Share |  |
| ✅ | Fun | Titles: everyone in the group gets a fun title, shown as a small chip under their name on Balances |  |
| ✅ | Fun | Where to? when making a trip (optional): the trip earns its passport stamp |  |
| ✅ | Fun | Trip passport opens like a booklet, and several countries from before Loopin can be added at once |  |
| ✅ | Fun | Share my passport sends one picture of the open booklet (details, map, every stamp), and nothing else |  |
| ✅ | Money | A big group of 12: a ₹1,200 dinner for everyone is ₹100 each, and all 12 balances are right | Varun +1100.00, Meera −100.00, Dev −100.00, Isha −100.00, Neel −100.00, Tara −100.00, Kabir −100.00, Lata −100.00, Omar −100.00, Pia −100.00, Sana −100.00, Yash −100.00 |
| ✅ | Money | In that group, ₹1,000 shared by 12 can't divide evenly: four people carry ₹83.34, eight ₹83.33, and nothing is lost | Varun +1016.67, Meera +816.67, Dev −183.33, Isha −183.33, Neel −183.33, Tara −183.33, Kabir −183.33, Lata −183.33, Omar −183.33, Pia −183.33, Sana −183.33, Yash −183.33 |
| ✅ | Money | Money back bigger than a share: Meera gets ₹600 back for the minibus, shared by all 12 (₹50 each) | Varun +1066.67, Meera +266.67, Dev −133.33, Isha −133.33, Neel −133.33, Tara −133.33, Kabir −133.33, Lata −133.33, Omar −133.33, Pia −133.33, Sana −133.33, Yash −133.33 |
| ✅ | Money | Settle up for 12 people: at most 11 payments, and together they move what the two people who are owed are owed | 10 payments, ₹1333.32 |
| ✅ | Money | Yen has no decimals: ¥1,000 shared by 3 is ¥334 + ¥333 + ¥333, then Kenji pays ¥2,400 (¥800 each) | Varun −133, Kenji +1267, Mika −1133 |
| ✅ | Imports | A plain spreadsheet from some other app: Loopin can't guess who paid, asks which column is which, and the balances come out exactly | Meera +566.66, Dev −233.33, Isha −333.33 |
| ✅ | Imports | Loopin's own spreadsheet for the 12-person group (with its refund) is brought back in: the copy has the same 12 balances to the paisa | Varun +1066.67, Meera +266.67, Dev −133.33, Isha −133.33, Neel −133.33, Tara −133.33, Kabir −133.33, Lata −133.33, Omar −133.33, Pia −133.33, Sana −133.33, Yash −133.33 |
| ✅ | Sharing | The pay link opened by someone who isn't signed in shows exactly what they owe (₹450); “I've paid” is only a claim until Varun confirms |  |
| ✅ | Sharing | A postcard with a wax seal: Asha sends it to Ravi, who opens it, turns it over and reads the message |  |
| ✅ | Sharing | A postcard sealed until next year can't be read early; once its day comes (the clock moved on in the test database) it opens |  |
| ✅ | Permissions | A postcard is for its sender and its receiver only: a third person gets “not found”, and signed out is sent to sign in |  |
| ✅ | Safety | Report and block: Ravi reports Asha's postcard (“We'll look at this within 24 hours”), blocks her from there, her card is gone from his view, and he unblocks from You |  |
| ✅ | Safety | AI question: You → Privacy and safety starts “Not asked yet”; Don't allow records no, Allow records yes; Contact support is there |  |
| ✅ | Privacy | Passport: hidden until the owner chooses. Ravi can't open Asha's before she answers; the question shows once, and Show opens it |  |
| ✅ | Sharing | Not now keeps a passport hidden and the question never comes back |  |
| ✅ | Sharing | Asha sends her passport to Ravi, who set his own to “Only me”: he gets it, and Asha still can't open his |  |
| ✅ | Privacy | Someone who hid their passport can't send it either (“change who can see it first”), and turning it back on restores both |  |
| ✅ | Permissions | Varun starts a new group; Ravi and Zoe join from its link. Ravi, an ordinary member, sees no delete / currency / remove controls |  |
| ✅ | Money | “Yesterday” is yesterday where the person is: the saved day, and the time zone the app was told, both match | 2026-11-12 in Asia/Kolkata |
| ✅ | Permissions | Ravi leaves the group himself; after that he sees it only up to the day he left |  |
| ✅ | Permissions | A leaver trying to edit: the Add screen says he left and offers no Save, and Varun's old expense opens read-only |  |
| ✅ | Permissions | Varun removes Zoe; she can't get back in with the old invite link or the old group address |  |
| ✅ | Regression | No screen scrolls sideways at this device's own size, including the 12-person and yen groups | 15 screens at 390 px wide |
| ➖ | Regression | On a 1440 px wide screen the app stays one tidy, centred column (no stretched screens) | not applicable on android: a wide window only exists on a computer (runs on desktop) |
| ✅ | Sharing | Android contact picker: “Pick from contacts” adds the chosen names to a collection (the phone's picker is stood in for) |  |
| ✅ | Notifications | Android buzz: tapping Add expense gives the light tap pattern (navigator.vibrate is stood in for and listened to) |  |
| ➖ | Onboarding | iPhone install hint: real Safari-engine on an iPhone 14 (not a pretend one) shows the “Add to Home Screen” steps from the invite link | not applicable on android: the Add to Home Screen steps are for Safari on an iPhone; Android and computers are shown other steps (runs on iphone) |
| ➖ | Regression | iPhone has no buzz: tapping Add expense still works and the page throws no errors | not applicable on android: only iPhones lack vibration while still being phones; the other profiles are checked by the Android buzz step (runs on iphone) |