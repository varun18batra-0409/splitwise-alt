---
name: ui-ux-audit
description: Use to review Loopin's screens for usability, navigation, consistency and accessibility from real screenshots — every screen at 320, 360 and 390 px plus desktop — and report findings with the exact screen and element.
---

# UI/UX audit

Hand the review to `ui-ux-auditor` (sonnet) for a focused pass, or `loopin-ux-reviewer` (opus) for a full review of the whole app. Both are read-only and open screenshots with Read.

## Get real screenshots first
- From CI: the `screenshots-<branch>` branch (folders by width: 320, 360, 390, plus `ios/` and `desktop/`; UAT failures in `uat/`). Download with `gh api "repos/<repo>/contents/<path>?ref=screenshots-<branch>" -H "Accept: application/vnd.github.raw"`.
- Name in the report exactly which files were opened. A screen nobody opened was not reviewed.
- Anything that needs tapping, typing or scrolling is **NEEDS BROWSER TEST** with steps, unless a run actually did it and left evidence.

## Screens to cover
Start and sign-in · welcome and join · Home · groups list · group (overview, expenses, balances, memories) · Add expense · Settle up · Pay and Waiting · Record a payment · Payment recorded · activity and search · updates · flats (bills, shopping, budget, deposit, collect) · trips (countdown, recap) · passport (Been, Want to go) · moments · postcards · Wrapped · You and settings · tour, FAQ, How Loopin works.

## Check each one for
- One main job and one cream button; clear Back; nothing important more than two taps away.
- Type: calm sizes (no giant amounts), clear hierarchy, nothing clipped, no words broken mid-word, no orphans.
- Colour only on money (green to you, orange you owe); no tints, no glow, no emoji in interface words, no all-caps labels.
- Money clarity: the same amount shown the same way everywhere on a screen; exact amounts on payment screens; nothing that could make someone pay the wrong person or amount.
- Fit: 320 px with no sideways scroll, nothing under the bottom bar, touch targets 44 px or more.
- Accessibility: contrast AA, labels on icon buttons, focus order, reduce motion.
- Words: plain, warm, sentence case, the same name for the same action everywhere; tour, FAQ and How Loopin works match the screens.

## Report
Verdict (ready / fix first), then findings most severe first: screen and element, SCREENSHOT-OBSERVED or SOURCE-CODE OBSERVATION, severity, why it matters to the person, the change to make. Then before-and-after pictures go to the founder once fixed.
