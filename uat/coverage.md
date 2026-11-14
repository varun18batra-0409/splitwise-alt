# UAT coverage: android

Android phone: Chromium, 390×844, touch, en-IN, Asia/Kolkata

200 steps: 102 passed, 94 failed, 1 not applicable, 3 not run.

| Area | Steps | Passed | Failed | Not applicable | Not run |
|---|---|---|---|---|---|
| Money | 83 | 23 | 57 | 1 | 2 |
| Onboarding | 22 | 14 | 8 | 0 | 0 |
| Permissions | 5 | 1 | 3 | 0 | 1 |
| Imports | 4 | 3 | 1 | 0 | 0 |
| Sharing | 20 | 14 | 6 | 0 | 0 |
| Notifications | 9 | 3 | 6 | 0 | 0 |
| Privacy | 10 | 5 | 5 | 0 | 0 |
| Regression | 47 | 39 | 8 | 0 | 0 |

Areas with fewer than 5 steps: Imports (4).

## Money

- ❌ 14. Equal split between everyone (Varun pays ₹1,200 dinner)
- ❌ 15. Someone else paid, only some people (Asha pays ₹400 taxi for Asha + Varun)
- ❌ 16. Next expense remembers the last split (“same as last time”)
- ❌ 17. Paid by someone else on their behalf: Varun records Ravi paid ₹600 for everyone
- ❌ 18. For one person only (₹1,000 tickets, just for Ravi)
- ❌ 19. Custom amounts that add up (₹1,000 = 100 + 200 + 300 + 400)
- ❌ 20. Custom amounts that DON'T add up are refused
- ❌ 21. Percentages (Zoe pays ₹2,000 hotel, 50% Varun / 50% Zoe)
- ❌ 22. Percentages that don't make 100% are refused
- ❌ 23. Yesterday's date and a note (₹400 coffee)
- ✅ 24. Wrong amounts are refused: letters, zero, empty name still saves as “Expense”?
- ❌ 25. Double-tapping Save adds the expense only once
- ❌ 26. Edit an amount (Coffee ₹400 → ₹800) and balances follow
- ❌ 27. Edit clash: Asha saves first, Varun's older copy is warned, not overwritten
- ❌ 28. Delete an expense, then Undo brings it back
- ❌ 29. Undo bar right after adding an expense removes it again
- ✅ 30. Set the group's card markup to 3%
- ❌ 31. Card payment abroad: THB 1,000 at 2.5 with 3% card fee = ₹2,575
- ❌ 32. Cash abroad has no card fee: THB 400 cash at 2.5 = ₹1,000
- ❌ 33. Card with the fee switched off: THB 200 at 2.5, no markup = ₹500
- ❌ 34. Custom 2% fee: THB 1,000 at 2.5 = ₹2,550
- ✅ 35. Live exchange rate is fetched for USD (or, if the rate service is down, a rate is asked for)
- ✅ 36. Balances shows the THB balance separately (without card fees)
- ❌ 40. “Why?” lines add up to the balance shown
- ✅ 41. Group page has a “Settle up” button that opens the settle screen
- ✅ 42. Bottom bar “Settle” inside a group goes to the same screen
- ❌ 43. Mark a payment as paid in full
- ❌ 44. Record a part payment (change the amount to less)
- ❌ 45. A zero or nonsense amount is refused
- ❌ 46. Double-tapping Record payment records it once
- ⏭️ 47. Undo a payment from the bar
- ⏭️ 48. “I’ve paid” is only a claim: balances don't move until Asha taps Confirm received
- ❌ 49. Record a different payment on the payment screen (Zoe paid Asha ₹50)
- ❌ 50. Paying more than owed (an extra zero) asks first and saves nothing until confirmed
- ❌ 51. You can't record paying yourself
- ✅ 52. Settle everything & close, then reopen
- ❌ 53. Two more groups with Asha: she owes ₹500 in one, Varun owes ₹300 in the other
- ❌ 54. Settle screen nets them into ONE payment: Asha pays Varun ₹200
- ❌ 55. All square page: a “Hide amounts” switch swaps the money tile for counts, and the shared picture follows
- ❌ 56. Create a Couple group with the split worked out from incomes (55 / 45), add Asha
- ❌ 57. “Our split 55 / 45” is chosen by default: ₹1,000 lunch → Asha owes ₹450
- ❌ 58. Two payers: ₹2,000 dinner, you ₹1,500 + Asha ₹500 → Asha owes ₹850 in all
- ❌ 59. Money back: Asha got ₹200 back, shared 55 / 45 → Asha owes ₹960
- ❌ 61. Save & add another keeps the split and opens a fresh form
- ❌ 62. Repeat an expense, see the duplicate warning, then add it anyway
- ❌ 82. Change a group's currency (UAT Dinner club INR → USD at 0.012)
- ❌ 87. Show amounts in a second currency (USD) next to balances
- ❌ 94. Change who paid on an expense: balances move by exactly that amount
- ✅ 95. Delete a payment from the history, then restore it
- ❌ 121. Create a Home group: it opens on Overview, with Expenses · People tabs and Bills · List tiles
- ❌ 122. Add Rent (₹30,000 on the 1st, you pay) and Electricity (changes each month, Asha pays)
- ❌ 123. The daily job runs twice: Rent is added once, Electricity waits for its amount
- ❌ 124. Asha taps “Enter amount”, types ₹2,840 and saves: Asha owes ₹13,580 in all
- ✅ 125. Shopping list: add Bread and Milk, tick both, enter ₹1,240 → one Groceries expense
- ✅ 126. A ₹1,500 Groceries budget with ₹1,240 spent shows “₹260 left” (nearly there)
- ✅ 128. The couple's This month says if you're ahead, behind or even
- ✅ 129. Start a savings goal (₹1,00,000) and tap “I set money aside” (₹5,000)
- ❌ 130. Delete the automatic Rent from its edit screen: the daily job doesn't add it back
- ❌ 131. Asha moves out: final payment shown, she's marked moved out, balances still add up to zero
- ❌ 134. Pause a bill and start it again from its page
- ✅ 135. Deposit: you put in ₹40,000; lease over with ₹2,000 kept back → ₹38,000 back to you
- ❌ 138. Change the split on an existing expense (Coffee ₹800: everyone → only You + Asha): balances move exactly
- ❌ 139. “Even out” on This month opens Settle; marking it paid makes you even
- ❌ 140. Settle-up minimum ₹50: a ₹45 balance isn't suggested as a payment, but stays in the balances
- ✅ 141. Milk (₹60 a day): tap today as “didn’t come” on its calendar and the month's total drops by ₹60
- ❌ 144. Settings has ONE Save; the group's currency is for the person who looks after it (Asha sees it as text, not a dropdown)
- ❌ 145. Rename an expense (Taxi → Airport taxi): the history says exactly what changed
- ✅ 146. Skip a bill this time: next month's Rent is marked skipped and won't be added
- ✅ 147. A ₹1,000 Groceries budget with ₹1,240 spent shows “₹240 over”
- ✅ 148. Note when someone moved in (Zoe, on the 10th): it's recorded on People and in the history
- ✅ 149. Set up Maintenance shared by % (you 70, the other 30); Groceries is one of the tiles
- ✅ 150. Change the goal (target ₹80,000), then remove it
- ❌ 158. Shares: ₹1,200 split 2 : 1 : 1 : 1 : 1 → Varun ₹400, the others ₹200 each
- ❌ 159. Split by item: ₹1,180 bar bill, Pizza ₹600 for Varun and Asha, Beer ₹400 for Asha → tax and tip shared by what each had: Varun ₹354, Asha ₹826
- ❌ 160. A bill photo stays with the expense: Asha can open it, and someone outside the group can't
- ✅ 161. Slow connection: Save shows Saving… and stays off; a second tap adds nothing; saved once
- ✅ 163. Editing shows the bill photo already kept, with Replace and Remove; Remove takes it off when saved
- ❌ 167. When every payment is under the group's minimum, Settle says “Nearly square”
- ✅ 170. A yen group shows no decimals anywhere, and its settle-up minimum reads in whole yen
- ❌ 171. A bill whose payer has moved out waits with “Add it”, and Add it comes pre-filled
- ❌ 175. Varun makes a Farewell collection (₹500 each, his UPI), lists Zoya and Kabir, and picks Asha from his Loopin friends
- ✅ 185. Type it in one line: “Snacks 600 split with everyone” fills the name, amount and split, and nothing saves until Save
- ➖ 192. Outside India: the You page has no UPI box; Varun saves a PayPal link and the “I’ve paid” page offers PayPal _(only on desktop)_

## Onboarding

- ✅ 1. First visit shows the intro tour with “Create your first group”
- ✅ 2. Creating a group asks you to sign up first (verified email)
- ✅ 3. There is no way to add people by typing a name
- ❌ 4. Create a group (INR) → lands on Add people
- ❌ 7. Ravi does the same from a WhatsApp message
- ✅ 13. Contacts option is there (share sheet when the phone can't pick contacts)
- ❌ 106. Sign out of this phone, sign back in: all groups come back
- ❌ 108. iPhone (Safari): invite link shows “Get the Loopin app” with Share → Add to Home Screen steps
- ❌ 109. iPhone (Chrome): steps use the Share button by the address bar
- ❌ 110. Android (Chrome): invite link offers the app; steps mention “Install app”
- ✅ 111. UX-04: the sign-in header is short (about 96px) on a short phone (390×667) and tall on a normal one (390×844), so the small-phone variant works for both width and height
- ✅ 112. You has the “Get the Loopin app” row (it moved off Home's header) and the service worker is registered (needed to install)
- ✅ 113. First-time tour (iPhone) has the “App” button on every slide
- ✅ 115. Tour → Home shows a start screen: create, join with a link, quick start, sign up / sign in
- ❌ 116. The “How Loopin works” row on You opens the detailed guide (with photos), which links to the 1-minute tour; Home's header has no “?”
- ✅ 117. The 1-minute tour has 7 slides (make a group, add what you paid, see who owes then settle, every trip becomes a story, send a postcard, keep the little moments, collect your passport), in words that work outside India, and none says “no sign-up”
- ✅ 118. The tour moves like stories: tap the right side for next, the left side to go back, and Back / Next buttons at the bottom
- ✅ 119. The guide has Home, Couples, the trip report, stories, Wrapped, the passport and moving over from another app, with real app screens that load
- ✅ 152. One screen for new and returning people; Continue with Google goes to Google with our app and PKCE; a forged return is refused
- ❌ 157. Fingerprint / face: turn it on, sign out, sign back in with one touch, then remove it _(only on android, desktop)_
- ✅ 164. A wrong code is refused with a clear message, and the right one still works
- ✅ 165. Right after signing in, “Sign in faster next time?” can be closed with ✕ and stays closed _(only on android, desktop)_

## Permissions

- ❌ 8. Only Varun, who started the group, can delete it, change its currency or remove people: Asha sees a calm note instead
- ❌ 91. Remove someone settled up (the admin removes; they show under Removed), then bring them back
- ❌ 92. Remove someone who isn't in any expense (Sheldon)
- ⏭️ 93. Someone owing money can't be marked as left until settled
- ✅ 180. Someone else can't change Varun's collection (no organiser buttons; a forged Confirm received is refused)

## Imports

- ✅ 81. Spreadsheet download contains the expenses
- ❌ 136. The flat's spreadsheet has the bills and the shopping
- ✅ 154. “Coming from another app?” → pick the exported file → balances checked → Bring it over: a new group with the same expenses, payments and balances
- ✅ 172. A file that isn't a known export gets a clear message; a second currency is flagged

## Sharing

- ❌ 5. Someone opening the link without signing up can't join (no name box)
- ❌ 6. Asha opens the link, signs up with her email, and joins
- ✅ 9. Add by email: Zoe is in the group at once as a name (“Invited · hasn’t joined yet”) and gets an invitation email
- ✅ 10. Zoe taps the link in her email, verifies, and joins as the name she was added with
- ✅ 11. Invite emails carry an unsubscribe link: one tap stops them, and the next invite to that address isn't sent
- ❌ 12. Add people shows everyone as “On Loopin ✓” and no pending invites
- ✅ 133. Zoe, already signed in, opens the flat's invite link, taps Join, and shows on People
- ✅ 153. Someone added by name only: “not on Loopin yet” → Invite by email → they open it, sign up, “Continue as Rohit”, and take over the name
- ✅ 155. Charts shows a few plain-English lines and “Trip report”; the report shares as a picture plus text (no link to the group)
- ✅ 162. A postcard link that doesn't exist: signed in → 'This screen isn't here'; signed out → sign-in first
- ✅ 166. Remind opens WhatsApp with the amount and who owes it
- ❌ 168. The invite screen shows the group's link and a QR code
- ✅ 173. Close the imported trip: Home links to the trip report, which says All settled; Copy as text works
- ❌ 177. Zoya opens the link with no sign-up: the UPI button has Varun's ID and ₹500 filled in; she ticks her name
- ❌ 191. Varun adds his UPI ID on the You page; his WhatsApp Remind carries it and an “I’ve paid” link that opens without signing in _(only on android, iphone)_
- ✅ 195. Wrapped: tap through the slides; the last one offers Share
- ✅ 197. Where to? when making a trip (optional): the trip earns its passport stamp
- ✅ 198. Trip passport opens like a booklet, and several countries from before Loopin can be added at once
- ✅ 199. Share my passport sends one picture of the open booklet (details, map, every stamp), and nothing else
- ✅ 200. Passport Been tab: Thailand 5–10 May 2026 (6 days) and Goa 13–15 Mar 2026 (3 days) show as cards, and the numbers read 2 countries, 2 trips, 9 days away

## Notifications

- ✅ 63. Turn off payment notifications for one group
- ❌ 65. Asha sees an unread alert badge and Varun's changes in Alerts
- ❌ 66. Asha was told she was added to the new groups
- ✅ 99. Alerts screen offers phone notifications on/off
- ❌ 100. Notifications & email: opens from You, an email switch persists after a reload, and with it off an add-to-group email isn't sent; switched back on it is
- ✅ 127. Reminders switch: on the flat's settings (off to start), not on the couple's
- ❌ 176. Asha (on Loopin) finds it in Alerts: “Varun added you: ₹500 each”
- ❌ 178. Varun sees “Zoya says paid” in Alerts, taps Confirm received, marks Kabir as paid in cash: 2 of 3, ₹1,000 of ₹1,500
- ❌ 179. Varun reminds Asha inside Loopin (bell); a second reminder straight away is refused; Asha sees it in Alerts

## Privacy

- ❌ 64. Search by name only finds friends; a full email gets the same neutral Add (no account revealed) and puts a stranger who is on Loopin in the group as an invited name
- ✅ 85. Signed in: You page shows the email; Sign in goes to it; privacy page opens
- ❌ 101. Adding the email of someone already on Loopin gets the same reply as any email; they see an invitation on Home and in Alerts
- ❌ 102. A stranger opening a group's address sees “Private group”: no name, no join link
- ✅ 103. A forged “who you are” cookie is ignored
- ✅ 104. An unsigned, plain “who you are” cookie (the old format) is ignored too
- ✅ 105. Sign-in can't send you to another website afterwards (back=/\evil.com)
- ❌ 107. Delete my email & sign-in
- ❌ 156. You → Download all my data: one spreadsheet with every group, my share and my balance change
- ✅ 174. A stranger can't open a group's report, its spreadsheet or someone else's data download

## Regression

- ✅ 37. Group top is short: balance, Settle up and See breakdown only (details moved to People)
- ✅ 38. Balances only explains; paying happens on Settle up (no duplicate buttons)
- ✅ 39. Activity has one Filter button that opens search, category and person
- ❌ 60. History filters by type and amount (money back only; ₹1,500 and more)
- ✅ 67. Home opens on the boarding-pass money card (route, one amount, ONE cream button; no tint, no “Add expense”, no repeated amount), a quiet line under it for what needs you, then Your groups and the bottom bar, which keeps its “+”
- ❌ 68. On a small phone (375×667) the header, the boarding-pass card (one-amount ticket at most about 200px tall, both-ways about 260px) and its buttons (44px tall) sit inside the first screen above the bottom bar, the Your groups row starts above the bottom bar, and the next polaroid peeks in; the bottom bar's + goes to the group picker or the only group
- ✅ 69. Home lists each group once: polaroid cards only (no old vertical list, no “Show all N groups”), each open group on one card, and the stories row is absent when there are no stories
- ✅ 70. F6/F10/F19: FAQ, Privacy and Terms on Home each have a 44px tap area with space between them; Latest says “Payment”, never “Settle-up”; the You page footer has a Privacy link with a 44px target
- ✅ 71. F5: an open story's full-screen photo is requested big and sharp (its image address asks for 1920px or wider, quality 90)
- ✅ 72. “+ New group” is the first card in Your groups (dashed, as tall as the polaroids, at least 44px), whatever the number of groups, and one tap opens the new-group page; “See all” stays in the header
- ✅ 73. Home order: Latest comes straight after Your groups (only the trip countdown may sit between); closed groups and Recently deleted are not on Home; the “saved on this phone” note is below everything but the footer
- ✅ 74. On the narrowest phone (320×640, also 360 and 390) the boarding-pass card has no sideways scroll: nothing is cut off, the amount always shows whole, the stub is 84px below 360px and 100px from 360px, the buttons keep their words inside, and the card has no tint
- ✅ 75. The bottom bar is nearly solid (background alpha 0.9 or more) so words never show through, and big amounts on Home are whole rupees
- ✅ 76. The sliding cards at the top: 4 to 7 of them, no two the same, each with words and a button that goes somewhere; no “Coming from another app?” card
- ✅ 77. Tapping an expense in Latest opens it in its group, expanded, with Edit or delete
- ✅ 78. Messages at the top have a ✕: closing one hides it, and a refresh doesn't bring it back
- ✅ 79. Bottom bar is hidden while adding an expense
- ✅ 80. Search finds “Dinner” across groups
- ❌ 83. Delete a group: it lands on Your groups with Recently deleted open (not on Home), You links to it, restore brings it back
- ✅ 84. Rename someone on the People screen
- ❌ 86. Rename a group, then Undo puts the old name back
- ❌ 88. Close a group from settings: it moves to Closed groups and new expenses are paused
- ❌ 89. Reopen it from the add screen
- ❌ 90. Rename a person, then rename back
- ✅ 96. Filter a group's history by category and person
- ✅ 97. Search by month: the recap shows totals
- ✅ 98. Charts tab opens with the group's spending
- ✅ 114. Inside a group there's a back button to all groups
- ❌ 120. Each expense shows its category: the icon's colour and shape, and the name for screen readers (Dinner → Bites & Sips, Taxi → Wheels & Wings)
- ✅ 132. Without the key the daily job is refused; with it, it runs
- ✅ 137. People search answers fast (5 searches, each timed)
- ✅ 142. Small Android phone (320 px), light mode: no screen scrolls sideways
- ✅ 143. Sign-in on small phones (320×568 and 375×667): Google and the email box are both on the first screen, no scrolling
- ✅ 151. The old address forwards to loopinapps.com, and a signed-in person arrives still signed in after one tap (once)
- ✅ 169. The group name at the top switches to another group
- ✅ 181. “What’s it for?” offers Trip, Home, Couple, Game night, Collect and Anything Goes; Game night explains itself; Collect opens Collect
- ✅ 182. A trip made with a start date in 10 days: the group says “in 10 days”, Home's Coming up shows its boarding pass with the trip's picture
- ✅ 183. A second trip in 30 days: Coming up is ONE section with two boarding passes, the soonest first; no “Also:” line, no separate cards
- ✅ 184. A photo picked while making a group becomes its picture
- ✅ 186. Add expense is tidy: the amount, the day under it, one What was it? field with Scan a bill · Speak · Type a line inside it, then two rows for who paid and the split; notes, several payers and Spin sit under a closed More link; the result for you is one quiet line under the card
- ✅ 187. Editing an expense that has notes opens More by itself, so nothing is hidden
- ✅ 188. No page says another app’s name: the tour, guide, FAQ, switching and import screens
- ✅ 189. Game night: none of poker, teen patti, buy-in, cash out, winnings or bet appears on the group-type chips, the game screens, the FAQ or How Loopin works; the calm line is on the game screen
- ✅ 190. The import screen gives generic export steps and no other app’s name
- ✅ 193. React 🔥 to an expense: it shows under the expense; tapping 🔥 again takes it back
- ✅ 194. Spin for it: the wheel lands on someone, and they become the payer
- ✅ 196. Titles: everyone in the group gets a fun title, shown as a small chip under their name on Balances
