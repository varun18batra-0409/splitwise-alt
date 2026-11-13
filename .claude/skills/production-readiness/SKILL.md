---
name: production-readiness
description: Use before proposing a Loopin release or launch — checks the build, tests, schema plan, backup, configuration, monitoring and rollback, and ends with a GO / CONDITIONAL GO / NO-GO for the founder.
---

# Production readiness

For an independent view hand this to `qa-release-auditor` (sonnet, read-only). Everything below is checked from evidence (run results, files), never assumed.

## Checklist
1. **Code:** the release commit's CI runs are green — Check (unit + build), screens, end-to-end and UAT on Android, iPhone and desktop. Quote the run and the numbers.
2. **Screens:** screenshots of every changed screen opened at 320, 360, 390 and desktop; before-and-after shown to the founder.
3. **Risky changes:** independent review done; confirmed findings fixed or accepted by the founder in writing.
4. **Database:** the schema plan (`schema-plan.yml`) shows only add-only changes that were expected; a backup (`backup.yml`, `scripts/backup.mjs`) is taken right before; restore has been checked recently (`scripts/restore-checks.mjs`).
5. **Configuration:** every environment variable the change needs exists in Vercel production (check names only, never values); feature switches set as intended.
6. **Monitoring:** health route (`src/app/api/health`), ops digest and mail (`ops-digest.ts`, `ops-mail.ts`), job failure alerts, speed checks — who gets told if something breaks, and how fast.
7. **Rollback:** the previous good deployment is known and can be promoted in Vercel (the founder or with his go-ahead); data changes are add-only so code rollback is safe; how long a data restore takes.
8. **After release:** live check of the main journeys on the real site without changing real users' data; watch errors for the first hour.
9. **Words:** release notes, FAQ, tour and How Loopin works match what ships; no other app's name shown to users.

## Decision
- **GO:** all of the above true.
- **CONDITIONAL GO:** only low-risk gaps, each with an owner and a date.
- **NO-GO:** any red run, an unreviewed money or permission change, no backup, or an unknown rollback.

Nothing is released without the founder's explicit yes. Write the result as a project note (`claude/release-<date>.md`).
