# Loopin's end-to-end tests (Playwright)

These tests use Loopin the way a person does: in a phone-sized Chrome browser, through the real screens. They never touch the live app (loopinapps.com) and never deploy anything.

## Where they run

| When | Where | Database |
|---|---|---|
| Every pull request, and every push to `main` or a `phase…` branch | A throwaway copy of the app, built and started on GitHub's machine | An empty file, thrown away afterwards |
| A push to the `staging` branch, or **Run workflow** by hand | Your private test copy on Vercel | The staging database (Turso) |

If the tests are pointed at loopinapps.com, or the staging database turns out to be the live one, they refuse to start.

## What's tested now

| File | Test |
|---|---|
| `01-home.spec.ts` | First visit: the tour, the start screen, and links to the guide, sign-in, "Coming from Splitwise?" and privacy |
| `02-auth-group.spec.ts` | Sign up with an email code and create a group; a wrong code is refused |
| `03-expenses.spec.ts` | Three people: a ₹900 equal split (Alice +₹600, Bob and Cara −₹300 each, seen from two phones); then the dinner is edited to ₹1,200 and the balances become +₹800 / −₹400 / −₹400 |
| `03-expenses.spec.ts` | **Must-fail check**: a deliberately wrong balance (₹1 off) must be caught. It's marked "expected to fail". If it ever passes, the suite fails, because that would mean the checks can't see mistakes |
| `05-splitwise-import.spec.ts` | Your real Splitwise file (4 expenses, ₹10,810, Varun Batra +₹105 / Nupur MDI −₹105). Shows as **blocked** until the file is supplied (see below) |
| `05-splitwise-import.spec.ts` | A made-up Splitwise file (fictional people), and a wrong file (a Loopin spreadsheet) that is refused with a clear message |

The older 150-step check (`scripts/uat.ts`) still runs as before. These Playwright tests are the new standard set and will grow stage by stage.

## Sign-in, codes and secrets

- Test people use addresses ending in `@e2e.loopin.test`. ".test" can never reach a real inbox.
- Their 6-digit code is kept in the test database and read from there. Signing in happens in a separate browser that isn't recorded, so codes never appear in traces, screenshots, logs or reports.
- At the end of each run (and at the start of the next), only test people and the groups they made are removed. A group is removed only if every signed-in member in it is a test person.

## Settings (GitHub → Settings → Secrets and variables → Actions)

| Name | Needed for | What it is |
|---|---|---|
| `STAGING_TURSO_DATABASE_URL` | Staging runs | The staging database's address |
| `STAGING_TURSO_AUTH_TOKEN` | Staging runs | Its access token |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Staging runs | Lets the tests open the private Vercel test copy |
| `TURSO_DATABASE_URL` | Safety check | The LIVE database address. It's only compared, never used, so staging can't point at live |
| `E2E_SPLITWISE_CSV_B64` | The real-file import test | Your Splitwise export, encoded so it fits in a secret (see below) |

### Adding the Splitwise file as a secret

The file contains real names and amounts, and the repository is public, so it isn't stored in the code.

1. On a computer, open a terminal in the folder with the file and run `base64 -w0 your-file.csv` (Mac: `base64 -i your-file.csv`).
2. Copy the long line it prints.
3. On GitHub, go to the repo → **Settings → Secrets and variables → Actions → New repository secret**. Name it `E2E_SPLITWISE_CSV_B64` and paste the line as the value.

Or ask Claude, who can prepare the line for you to paste.

## Running the tests

- **Automatically:** open a pull request, or push to `main`, a `phase…` branch or `staging`.
- **By hand:** GitHub → **Actions** → **E2E tests** → **Run workflow**, then pick `staging` or `local`.
- **On a computer:** `npm install`, then `npx playwright install chromium`. Start the app with `npm run dev`, then run `MAIL_OUTBOX=1 npm run test:e2e`. Run `npm run test:e2e:report` to open the report.

## Reading results

1. Open the run under **Actions → E2E tests**. The run's main page has a summary table: passed, failed, and blocked with the reason.
2. Download **e2e-report-…** under *Artifacts*. Unzip it and open `index.html` for the full report.
3. If something failed, also download **e2e-failures-…**. For each failed test it has:
   - a screenshot;
   - `browser-console.txt` (the browser's messages);
   - `trace.zip`, a step-by-step replay you can open at https://trace.playwright.dev, which shows every tap, every screen and every network call.
4. To run it again: open the run and choose **Re-run jobs**.

## Rules the tests follow

- Staging or a throwaway copy only; never the live app.
- Real people's groups are never deleted or changed.
- No account deletion or anything irreversible.
- Every run uses its own names (`E2E … gh<run id>`) and tidies up after itself.
- One test at a time, so tests can't trip over each other.
- If staging can't be reached, or a secret is missing, the run stops with a message saying which.

## Next stages

Each stage is added only once the one before is stable.

1. Authentication, groups and invitations
2. Every split type, editing, deletion and undo
3. Balances, settlements and cross-group netting
4. Currency conversion, card fees and rounding
5. Flatmates' recurring bills and the daily job
6. Couples, savings goals and reports
7. Splitwise imports, email delivery and notifications
8. Phone sizes, accessibility and regression checks
