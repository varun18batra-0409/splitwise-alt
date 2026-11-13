---
name: feature-development
description: Use when building a new Loopin feature or a meaningful change — agree it with the founder, plan, build in small tested steps on a test branch, review, check screenshots, and only then propose release.
---

# Feature development, in controlled steps

The founder isn't a programmer: explain in plain English, and tell him what will be built before building unless he has said to build.

## Steps
1. **Agree what and why.** One short note: what changes for the person using Loopin, which screens, what it replaces or pushes down (`loopin-calm-ux`). For anything new or creative, discuss options first. Park ideas he hasn't approved.
2. **Pick the route** with `loopin-model-router`. Money, permissions, settlement, security or schema → `loopin-planner` (opus) writes the plan and the tests that must pass before any code.
3. **Branch.** Work on a `phase-*` test branch in its own worktree. Never on `main`.
4. **Build in small steps**, each with its tests (`loopin-implementer`, sonnet). Hand-worked expected numbers for money; a must-fail test for permissions.
5. **Look and words.** Follow `loopin-premium-bar` and the agreed design references: calm type, colour only on money, one cream button, real photos, no emoji in UI words. Update the tour, FAQ and How Loopin works when the feature is worth a mention.
6. **Run the checks** (`testing-release-safety`): push with `[full]` for anything beyond a small tweak; read the results; open the screenshots at 320, 360 and 390.
7. **Independent review** for risky work (`independent-code-audit`), with the diff only.
8. **Show the founder** before-and-after pictures and a plain summary: what changed, what was tested, anything left.
9. **Release only on his explicit yes**, following the release steps (schema plan, backup, then main), and check the live site afterwards.

## Keep a note
Write a short project note (`claude/<feature>-<date>.md`) with the decisions, so the next session doesn't re-ask.
