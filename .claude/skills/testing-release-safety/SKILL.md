---
name: testing-release-safety
description: Use for every Loopin change before calling it done — decides which tests must run, adds the regression test for the bug being fixed, and enforces the release gates (nothing ships without passing runs and the founder's approval).
---

# Testing and release safety

## Which checks a change needs
| Change | Must pass |
|---|---|
| Words or spacing only | Build (type-check) + phone tests + screenshots looked at |
| One screen or component | Build + unit tests + screenshots at 320/360/390 (Android and iPhone) looked at |
| Logic, data, many screens | Full run: put `[full]` in the commit message (unit, end-to-end, UAT walk-through on Android, iPhone and desktop, screenshots) |
| Money, permissions, settlement, security, schema | Full run **plus** an independent read-only review (`financial-integrity-auditor`, `security-database-auditor` or `loopin-auditor`) of the diff only |

Where things run: `npm test` (Vitest, `tests/`), `npm run test:e2e` (Playwright, `e2e/`), `scripts/uat.ts`, `scripts/screenshots.ts`; CI in `.github/workflows/ci.yml` (branches `phase*`, `next*`, `staging`, `main`), `e2e.yml`, `exercise-a.yml`. Screenshots land on the `screenshots-<branch>` branch, failures as `uat/fail-NN.png`.

## Regression rule
Every bug fixed gets a test that fails without the fix. Write the expected values out by hand. Look at the failing screenshot before guessing at a cause.

## Gates (all must be true before a release is proposed)
1. The latest commit's runs are green — read from the runs themselves, not assumed. A run cancelled by a newer push doesn't count.
2. Every changed screen's screenshots were opened and judged.
3. Risky changes have the independent review, with findings fixed or explicitly accepted by the founder.
4. Schema changes are add-only and the schema plan shows only what was expected; a backup is taken before release.
5. The founder has said yes to this release in this conversation.

## Never
- Claim a test passed without seeing its result. Say "not run" when it wasn't.
- Test against production or real groups; tests use staging or throwaway copies.
- Print secrets, OTPs or tokens in logs or reports.
- Push to main, deploy, merge or migrate without the founder's explicit go-ahead.
- Skip or loosen a failing test to get green; fix the cause or ask.
