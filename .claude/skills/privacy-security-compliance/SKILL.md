---
name: privacy-security-compliance
description: Use to check how Loopin handles personal data — what is collected, who can see it, logging, export and deletion, sign-in and sessions, photos, consent and access controls — before a release or when a change touches any of these.
---

# Privacy and security compliance

Read-only checks go to `security-database-auditor` (opus). This is not legal advice; flag anything that may need a lawyer's view for the founder.

## Personal data map (keep it current)
Name, email, phone (optional), Google sign-in id, passkeys, payment handles (UPI ID etc.), group memberships and money, photos (group covers, postcards, moments, receipts), passport places, push subscriptions, AI consent, reports and blocks.

## Check
- **Collection:** only what a feature needs; optional things are optional.
- **Who can see it:** other members, people who left, blocked people, signed-out visitors (see `group-membership-permissions`). Passports never show money, groups or email; private passports are excluded everywhere.
- **Logging:** no names, emails, amounts with names, OTPs, tokens or photo ids in logs or error reports (`scrub.ts`); errors don't leak internals to the page.
- **Sign-in and sessions** (`auth.ts`, `session.ts`, `identity.ts`, `passkeys.ts`, `google.ts`): OTP expiry and attempt limits, cookie flags (HttpOnly, Secure, SameSite), session expiry, sign out everywhere, rate limits (`rate-limit.ts`).
- **Photos** (`photo-store.ts`, `strip-meta.ts`, `image-size.ts`): location and camera data removed, type and size checked, stored privately, served `private, no-cache`, removed when the thing they belong to is deleted.
- **Export and deletion** (`my-data*.ts`, `src/app/api/my-data`, `purge.ts`): export contains everything that is the person's; deletion removes or anonymises everything within the promised window while keeping other people's balances correct.
- **Consent:** AI features only after consent (`ai-consent.ts`); notifications only after opt-in; unsubscribe works (`unsubscribe.ts`).
- **Policies:** `src/app/privacy`, `terms` and the FAQ say what the app actually does.
- **Repo and secrets:** the repo is public — no secrets, real user data or `research/` in it; secrets only in GitHub and Vercel settings, never printed.

## Report
Verdict (safe / fix first); findings with file:line, CONFIRMED or POTENTIAL RISK, severity, who is affected and how, the fix and the test. Never include real personal data or secrets in the report.
