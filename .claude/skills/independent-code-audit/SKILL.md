---
name: independent-code-audit
description: Use to run a read-only architectural, security or correctness review of Loopin code or a change someone else made — hands the diff to a fresh auditor agent and reports confirmed defects separately from possible risks.
---

# Independent code audit

The reviewer must not have seen how the change was made. It gets the code or the diff and the goal in one sentence, never the author's reasoning.

## Pick the auditor
| Area | Agent (model) |
|---|---|
| Money, splits, balances, settle up, currency, refunds, undo | `financial-integrity-auditor` (opus) |
| Sign-in, sessions, permissions, invites, uploads, privacy, schema | `security-database-auditor` (opus) |
| Architecture or a mixed change | `loopin-auditor` (opus) |
| Still unresolved after an Opus pass | `loopin-deep-investigator` (fable; falls back to opus — say so) |

All of them are read-only (Read, Grep, Glob). They never edit, run commands, touch a database or read secrets.

## What to hand over
- The diff (`git diff <base>...<head>`) saved to a file, or a list of files and the area.
- One sentence on what the change is meant to do.
- Nothing else: no explanation of the approach, no "I think it's fine".

## What the report must contain
- A verdict first.
- Each finding: file:line, **CONFIRMED** (every guard traced) or **POTENTIAL RISK** (not fully traced), severity, a concrete failure scenario with real numbers or a real sequence of taps, the smallest fix, and the test that proves it.
- Clean areas in one line each. Lists of files read in full and skimmed.

## After the report
- Don't argue findings away. Check each one against the code; if it's wrong, say why with file:line.
- Fix confirmed defects with a test each, then send the new diff for a second review if the fix touched money or permissions.
- Tell the founder in plain English: what was found, what was fixed, what's left and why.
