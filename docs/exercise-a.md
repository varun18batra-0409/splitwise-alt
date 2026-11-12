# Exercise A: the complete automatic test run

Exercise A is one button that tests the whole app the way a careful reviewer would, then writes down what happened in plain English. It is meant to be handed to an independent reviewer before applying to the app stores.

It never touches the live app, never uses a secret, and never sends an email. Everything runs on GitHub's machines on a database that is a file thrown away afterwards.

## What it tests

| Part | What it is | Where the result is |
|---|---|---|
| **Tap-through (UAT) on an Android phone** | About 215 steps: a person using the real screens. Every amount is checked against a separate calculation worked out by hand, not against the app's own sums. | artifact `uat-android` |
| **Tap-through on an iPhone** | The same steps in Safari's engine (WebKit) on an "iPhone 14". | artifact `uat-iphone` |
| **Tap-through on a computer** | The same steps in a 1440 x 900 window, in England's time zone. This also checks there is no sideways scrolling and that dates and money are right in another time zone. | artifact `uat-desktop` |
| **Unit tests** | Every automatic test in the `tests` folder (money rules, who-can-do-what, and more). | artifact `unit-junit` |
| **End-to-end tests** | The Playwright tests on Android, iPhone and desktop. | artifact `e2e-report` |
| **Summary** | One page: totals, every failure, what was "not applicable". | artifact `exercise-a-summary`, and the `exercise-a-results` branch |

The test people are all made up, with addresses ending in `@uat.loopin.test` or `@e2e.loopin.test`. Their emails stay in the throwaway database.

Some steps only make sense on one kind of device (for example the Android contact picker, the iPhone "Add to Home Screen" hint, or the phone buzz). On the other devices they are listed as **not applicable** with the reason. They are never skipped quietly.

## How to run it

1. On GitHub, open the **Actions** tab, pick **Exercise A** on the left, press **Run workflow**, choose the branch, and confirm.
2. Or push to a branch called `exercise-a`. That starts it by itself.
3. Wait. The three tap-throughs run side by side and take roughly 20 to 40 minutes. The end-to-end run is the longest.

You do not need to install anything.

## How to read the results

1. Open the finished run. At the bottom of the page, under **Summary**, is the page the last job wrote. At the top it says **CLEAN** or **NOT CLEAN** and lists each thing to look at.
2. For the detail, open the artifacts (the files at the bottom of the run page):
   - **uat-android / uat-iphone / uat-desktop**: `report.md` lists every step with a tick, a cross or a dash (not applicable). `coverage.md` and `coverage.json` show which area each step belongs to: Money, Onboarding, Permissions, Imports, Sharing, Notifications, Privacy and Regression. They name any area with fewer than 5 steps. A picture of the screen is kept for each failed step (`fail-01.png` and so on). `uat.log` and `server.log` are the raw logs.
   - **unit-junit**: `vitest-junit.xml`, the standard test report that other tools can read.
   - **e2e-report**: three folders (Android, then `-ios`, then `-desktop`). Open `index.html` in each to see every test, with screenshots and a replay for the ones that failed.
3. The same files are copied to the **`exercise-a-results`** branch, so a reviewer can browse them without opening the run.

What the symbols mean in `report.md`: a tick passed, a cross failed, a dash is "not applicable on this device".

## Good to know

- One device failing does not stop the others. A red job means that part found a problem; the results are kept either way.
- The end-to-end test that reads a real Splitwise export shows as **blocked**. That is on purpose: Exercise A never uses a secret or real data.
- The tap-through steps added for Exercise A (the group of 12, yen, a refund bigger than a share, importing a plain spreadsheet and Loopin's own, the signed-out pay link, sealed postcards, hidden passports, someone who left or was removed) are at the end of `scripts/uat.ts`.
- Where a step needs a moment that has not happened yet (a postcard sealed until next year), the test moves that date in its own throwaway database, never in anything live.
- To run one device by hand on your own machine: start the app, then `UAT_PROFILE=iphone npx tsx scripts/uat.ts` (use `android`, `iphone` or `desktop`; the default is `android`).
