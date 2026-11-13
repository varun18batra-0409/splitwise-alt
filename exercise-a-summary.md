# Exercise A: results

Run: https://github.com/varun18batra-0409/splitwise-alt/actions/runs/43462140081  
Commit: db7d581f29e5863f0afa74756d7469523a8ff1eb  
Written: 2026-11-13T16:49:26.027Z  
Jobs: uat=failure unit=success e2e=success

## Verdict: FAILED, 4 thing(s) to look at

- Job "uat" ended as failure (expected success)
- UAT android: 4 step(s) failed
- UAT iphone: 4 step(s) failed
- UAT desktop: 4 step(s) failed

Not failures, but not passes either (each has its reason). These are the steps and tests that did not run:

- UAT android: NOT RUN "Undo a payment from the bar" (nothing left to pay)
- UAT android: NOT RUN "“I’ve paid” is only a claim: balances don't move until Asha taps Confirm received" (Varun pays nobody who has joined right now)
- UAT android: NOT RUN "Someone owing money can't be marked as left until settled" (everyone settled)
- UAT iphone: NOT RUN "Undo a payment from the bar" (nothing left to pay)
- UAT iphone: NOT RUN "“I’ve paid” is only a claim: balances don't move until Asha taps Confirm received" (Varun pays nobody who has joined right now)
- UAT iphone: NOT RUN "Someone owing money can't be marked as left until settled" (everyone settled)
- UAT desktop: NOT RUN "Undo a payment from the bar" (nothing left to pay)
- UAT desktop: NOT RUN "“I’ve paid” is only a claim: balances don't move until Asha taps Confirm received" (Varun pays nobody who has joined right now)
- UAT desktop: NOT RUN "Someone owing money can't be marked as left until settled" (everyone settled)
- End-to-end Android: skipped "05-splitwise-import.spec.ts › import the supplied Splitwise CSV: 4 expenses, ₹10,810, Nupur MDI gets…" because "BLOCKED: the Splitwise CSV wasn't supplied (secret E2E_SPLITWISE_CSV_B64 / E2E_SPLITWISE_CSV)."
- End-to-end iPhone: skipped "05-splitwise-import.spec.ts › import the supplied Splitwise CSV: 4 expenses, ₹10,810, Nupur MDI gets…" because "BLOCKED: the Splitwise CSV wasn't supplied (secret E2E_SPLITWISE_CSV_B64 / E2E_SPLITWISE_CSV)."
- End-to-end iPhone: skipped "10-auth.spec.ts › fingerprint / face: turn it on, sign out, sign back in with one touch, remove it" because "Uses Chrome's built-in test fingerprint reader; Safari's engine has none in tests (checked on Android)."
- End-to-end iPhone: skipped "38-gestures.spec.ts › Gestures: swipe to delete an expense, drag a sheet closed, confetti on all squ…" because "Touch drags are built with Chrome's Touch objects (checked on Android)."
- End-to-end Desktop: skipped "05-splitwise-import.spec.ts › import the supplied Splitwise CSV: 4 expenses, ₹10,810, Nupur MDI gets…" because "BLOCKED: the Splitwise CSV wasn't supplied (secret E2E_SPLITWISE_CSV_B64 / E2E_SPLITWISE_CSV)."

The test accounts are all `@uat.loopin.test` or `@e2e.loopin.test`; every email stayed in a throwaway database file; nothing live was touched.

## UAT: a person tapping through every feature, on each device

| Device | Profile | Passed | Failed | Not applicable | Not run | Steps |
|---|---|---|---|---|---|---|
| android | Android phone: Chromium, 390×844, touch, en-IN, Asia/Kolkata | 216 | 4 | 4 | 3 | 227 |
| iphone | iPhone 14: WebKit (Safari's engine), en-IN, Asia/Kolkata | 214 | 4 | 6 | 3 | 227 |
| desktop | Desktop: Chromium, 1440×900, no touch, en-GB, Europe/London | 215 | 4 | 5 | 3 | 227 |

### android: failures

| # | Area | Step | What went wrong |
|---|---|---|---|
| 44 | Money | Record a part payment (change the amount to less) | page.waitForURL: Timeout 15000ms exceeded. =========================== logs =========================== waiting for navigation until "load" (screenshot: fail-01.png) |
| 45 | Money | A zero or nonsense amount is refused | locator.waitFor: Timeout 15000ms exceeded. Call log: - waiting for getByText(/more than zero/valid amount/) to be visible (screenshot: fail-02.png) |
| 46 | Money | Double-tapping Record payment records it once | balances differ: Varun shows ₹0.00 expected ₹1082.50; Zoe shows ₹0.00 expected ₹-1082.50 (screenshot: fail-03.png) |
| 49 | Money | Record a different payment on the payment screen (Zoe paid Asha ₹50) | page.waitForURL: Timeout 15000ms exceeded. =========================== logs =========================== waiting for navigation until "load" [browser errors: console Blocked call to navigator.vibrate because user hasn't tapped on the frame or any embedded frame yet: https://www.chromestatus.com/feature/56442738610012] (screenshot: fail-04.png) |

### iphone: failures

| # | Area | Step | What went wrong |
|---|---|---|---|
| 44 | Money | Record a part payment (change the amount to less) | page.waitForURL: Timeout 15000ms exceeded. =========================== logs =========================== waiting for navigation until "load" [browser errors: pageerror Fetch API cannot load http: /localhost:3000/api/unread due to access control checks. / pageerror Fetch API cannot load http: /localhost:3000/api/unread due to access control checks. / pageerror Fetch API cannot load http: /localhost:… |
| 45 | Money | A zero or nonsense amount is refused | locator.waitFor: Timeout 15000ms exceeded. Call log: - waiting for getByText(/more than zero/valid amount/) to be visible [browser errors: pageerror Fetch API cannot load http: /localhost:3000/api/unread due to access control checks. / pageerror Fetch API cannot load http: /localhost:3000/api/unread due to access control checks. / pageerror Fetch API cannot load http: /localhost:3000/api/unread du… |
| 46 | Money | Double-tapping Record payment records it once | balances differ: Varun shows ₹0.00 expected ₹1082.50; Zoe shows ₹0.00 expected ₹-1082.50 [browser errors: pageerror Fetch API cannot load http: /localhost:3000/api/unread due to access control checks. / pageerror Fetch API cannot load http: /localhost:3000/api/unread due to access control checks. / pageerror Fetch API cannot load http: /localhost:3000/api/unread due to access control checks.] (scr… |
| 49 | Money | Record a different payment on the payment screen (Zoe paid Asha ₹50) | page.waitForURL: Timeout 15000ms exceeded. =========================== logs =========================== waiting for navigation until "load" [browser errors: pageerror Fetch API cannot load http: /localhost:3000/api/unread due to access control checks. / pageerror Fetch API cannot load http: /localhost:3000/api/unread due to access control checks. / pageerror Fetch API cannot load http: /localhost:… |

### desktop: failures

| # | Area | Step | What went wrong |
|---|---|---|---|
| 44 | Money | Record a part payment (change the amount to less) | page.waitForURL: Timeout 15000ms exceeded. =========================== logs =========================== waiting for navigation until "load" (screenshot: fail-01.png) |
| 45 | Money | A zero or nonsense amount is refused | locator.waitFor: Timeout 15000ms exceeded. Call log: - waiting for getByText(/more than zero/valid amount/) to be visible (screenshot: fail-02.png) |
| 46 | Money | Double-tapping Record payment records it once | balances differ: Varun shows ₹0.00 expected ₹1082.50; Zoe shows ₹0.00 expected ₹-1082.50 (screenshot: fail-03.png) |
| 49 | Money | Record a different payment on the payment screen (Zoe paid Asha ₹50) | page.waitForURL: Timeout 15000ms exceeded. =========================== logs =========================== waiting for navigation until "load" [browser errors: console Blocked call to navigator.vibrate because user hasn't tapped on the frame or any embedded frame yet: https://www.chromestatus.com/feature/56442738610012] (screenshot: fail-04.png) |

### Steps that did not run (never counted as passed)

| Device | Step | Why it did not run |
|---|---|---|
| android | Undo a payment from the bar | nothing left to pay |
| android | “I’ve paid” is only a claim: balances don't move until Asha taps Confirm received | Varun pays nobody who has joined right now |
| android | Someone owing money can't be marked as left until settled | everyone settled |
| iphone | Undo a payment from the bar | nothing left to pay |
| iphone | “I’ve paid” is only a claim: balances don't move until Asha taps Confirm received | Varun pays nobody who has joined right now |
| iphone | Someone owing money can't be marked as left until settled | everyone settled |
| desktop | Undo a payment from the bar | nothing left to pay |
| desktop | “I’ve paid” is only a claim: balances don't move until Asha taps Confirm received | Varun pays nobody who has joined right now |
| desktop | Someone owing money can't be marked as left until settled | everyone settled |

### Steps marked "not applicable" (only for other devices)

These are listed on purpose, never skipped quietly. Each one runs on the devices named.

| Step | Runs on | Not applicable on | Why |
|---|---|---|---|
| Outside India: the You page has no UPI box; Varun saves a PayPal link and the “I’ve paid” page offers PayPal | desktop | android, iphone | this is the outside-India path (PayPal, Venmo, Revolut, Monzo); in India the UPI step above runs instead (runs on desktop) |
| On a 1440 px wide screen the app stays one tidy, centred column (no stretched screens) | desktop | android, iphone | a wide window only exists on a computer (runs on desktop) |
| iPhone install hint: real Safari-engine on an iPhone 14 (not a pretend one) shows the “Add to Home Screen” steps from the invite link | iphone | android, desktop | the Add to Home Screen steps are for Safari on an iPhone; Android and computers are shown other steps (runs on iphone) |
| iPhone has no buzz: tapping Add expense still works and the page throws no errors | iphone | android, desktop | only iPhones lack vibration while still being phones; the other profiles are checked by the Android buzz step (runs on iphone) |
| Fingerprint / face: turn it on, sign out, sign back in with one touch, then remove it | android, desktop | iphone | needs Chrome's built-in test fingerprint reader, which Safari's engine does not have; check by hand on a real iPhone (runs on android, desktop) |
| Right after signing in, “Sign in faster next time?” can be closed with ✕ and stays closed | android, desktop | iphone | needs Chrome's built-in test fingerprint reader, which Safari's engine does not have; check by hand on a real iPhone (runs on android, desktop) |
| Android contact picker: “Pick from contacts” adds the chosen names to a collection (the phone's picker is stood in for) | android | iphone, desktop | the Contact Picker only exists in Chrome on Android; iPhones and computers type the names instead (runs on android) |
| Android buzz: tapping Add expense gives the light tap pattern (navigator.vibrate is stood in for and listened to) | android | iphone, desktop | phones that buzz are Android phones; iPhones ignore vibration and computers have no motor (runs on android) |
| Varun adds his UPI ID on the You page; his WhatsApp Remind carries it and an “I’ve paid” link that opens without signing in | android, iphone | desktop | UPI is shown only in India; this viewer is en-GB in London, who gets the pay-link step below instead (runs on android, iphone) |

### Coverage by area (steps, across the three devices)

| Area | android (pass/fail/n.a./not run) | iphone (pass/fail/n.a./not run) | desktop (pass/fail/n.a./not run) |
|---|---|---|---|
| Money | 82/4/1/2 | 82/4/1/2 | 83/4/0/2 |
| Onboarding | 22/0/1/0 | 21/0/2/0 | 22/0/1/0 |
| Permissions | 9/0/0/1 | 9/0/0/1 | 9/0/0/1 |
| Imports | 6/0/0/0 | 6/0/0/0 | 6/0/0/0 |
| Sharing | 25/0/0/0 | 24/0/1/0 | 23/0/2/0 |
| Notifications | 10/0/0/0 | 9/0/1/0 | 9/0/1/0 |
| Privacy | 12/0/0/0 | 12/0/0/0 | 12/0/0/0 |
| Regression | 50/0/2/0 | 51/0/1/0 | 51/0/1/0 |

Every area has at least 5 steps.

## Unit tests (vitest)

1987 passed · 0 failed · 0 skipped · 1987 tests in 177 files

## End-to-end (Playwright)

| Device | Passed | Failed | Skipped or blocked | Flaky | Total |
|---|---|---|---|---|---|
| Android | 71 | 0 | 1 | 0 | 72 |
| iPhone | 69 | 0 | 3 | 0 | 72 |
| Desktop | 71 | 0 | 1 | 0 | 72 |

### Skipped or blocked tests (the reason is the one the run recorded)

| Device | Test | Reason the run recorded | Owner | What covers it instead |
|---|---|---|---|---|
| Android | 05-splitwise-import.spec.ts › import the supplied Splitwise CSV: 4 expenses, ₹10,810, Nupur MDI gets ₹105 / Varun Batra owes ₹105 | BLOCKED: the Splitwise CSV wasn't supplied (secret E2E_SPLITWISE_CSV_B64 / E2E_SPLITWISE_CSV). | founder (supplies the secret for staging runs) | Import parsing is covered by unit tests; the real-file import runs in the staging E2E when the secret is set |
| iPhone | 05-splitwise-import.spec.ts › import the supplied Splitwise CSV: 4 expenses, ₹10,810, Nupur MDI gets ₹105 / Varun Batra owes ₹105 | BLOCKED: the Splitwise CSV wasn't supplied (secret E2E_SPLITWISE_CSV_B64 / E2E_SPLITWISE_CSV). | founder (supplies the secret for staging runs) | Import parsing is covered by unit tests; the real-file import runs in the staging E2E when the secret is set |
| iPhone | 10-auth.spec.ts › fingerprint / face: turn it on, sign out, sign back in with one touch, remove it | Uses Chrome's built-in test fingerprint reader; Safari's engine has none in tests (checked on Android). | founder (release checklist) | The Android (phone) run covers it; fingerprint or face sign-in on a real iPhone is a manual release-checklist item |
| iPhone | 38-gestures.spec.ts › Gestures: swipe to delete an expense, drag a sheet closed, confetti on all square | Touch drags are built with Chrome's Touch objects (checked on Android). | founder (release checklist) | The Android (phone) run does the same swipe, drag and confetti test; drag, swipe, keyboard, back gesture and scroll recovery on a real iPhone are manual release-checklist items |
| Desktop | 05-splitwise-import.spec.ts › import the supplied Splitwise CSV: 4 expenses, ₹10,810, Nupur MDI gets ₹105 / Varun Batra owes ₹105 | BLOCKED: the Splitwise CSV wasn't supplied (secret E2E_SPLITWISE_CSV_B64 / E2E_SPLITWISE_CSV). | founder (supplies the secret for staging runs) | Import parsing is covered by unit tests; the real-file import runs in the staging E2E when the secret is set |

The test that needs a real Splitwise export shows as blocked here on purpose: Exercise A never uses a secret or real data. Real-iPhone checks (drag and swipe gestures, keyboard, back gesture, scroll recovery) are not covered by this run; they stay on the release checklist.

## Where everything is

- Artifacts of this run: `uat-android`, `uat-iphone`, `uat-desktop` (report.md, coverage.md, coverage.json, screenshots of failures), `unit-junit`, `e2e-report` (open `index.html` in each folder), `e2e-json`, `exercise-a-summary`.
- The same files are saved on the `exercise-a-results` branch.

