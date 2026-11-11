---
name: loopin-model-router
description: Use at the start of every Loopin task to pick the right subagent and model (Haiku, Sonnet, Opus, Fable), and to set up plan → build → independent review → verify for risky work. Also use when asked which model handled something.
---

# Loopin model router

Pick the cheapest model that can do the job well. Escalate only for a reason you can name.

## 1. Classify the request (first match wins)

| Class | Examples | Agent | Model |
|---|---|---|---|
| Exceptional | A critical finding still unresolved after an Opus pass; an investigation two passes couldn't explain; data loss or money drift with no known cause | `loopin-deep-investigator` | `fable` |
| Risky | Architecture; security or access control; independent technical audit; money maths, settlement, currency, refunds, balances; authorization; complex or intermittent bugs; full UI/UX review; product strategy | `loopin-planner`, `loopin-auditor`, `loopin-ux-reviewer` or `loopin-product-strategist` | `opus` |
| Everyday | Feature work, UI changes, ordinary bugs, unit/integration/E2E tests, regression runs, refactors inside one area | `loopin-implementer`, `loopin-verifier` | `sonnet` |
| Simple | Docs, release notes, copy tweaks with no logic, renames, lists, summaries of one file, low-risk lookups | `loopin-docs-helper` | `haiku` |

Signals that move a task up a class: it touches `src/lib/balances.ts`, `split.ts`, `settle*.ts`, `cross-settle.ts`, `rebase.ts`, `group-changes.ts`, `undo.ts`, `save-expense.ts`, `payment-ok.ts`, `pot-db.ts`, `home/moving*.ts`, `auth.ts`, `session.ts`, `identity.ts`, `passkeys.ts`, `google.ts`, `invites.ts`, `passport-db.ts`, `middleware.ts`, any `*actions.ts` guard, `prisma/schema.prisma`, or `scripts/turso-sync.mjs`. The same applies to anything about who can see or change what.

Signals that move a task down a class: wording only, one file, no money, no permissions, easy to undo.

Never escalate a trivial task to look thorough. If unsure between two classes, take the lower one and say why. Escalate the moment a real risk signal appears.

## 2. How work flows

- **Simple / everyday:** one agent does it. For everyday work, `loopin-verifier` runs the relevant tests afterwards.
- **Risky changes** (money, authorization, settlement, security, schema): four separate agents, in this order:
  1. `loopin-planner` (opus, read-only) writes the plan and the tests that must pass.
  2. `loopin-implementer` (sonnet) builds it, with tests.
  3. `loopin-auditor` (opus, read-only, fresh context) reviews the change independently. It never sees the implementer's reasoning, only the diff and the code.
  4. `loopin-verifier` (sonnet) runs the executable tests and reports what actually ran.

  A risky change is not done without both the independent review and passing executable tests.
- **Audits and reviews:** read-only agents only. They report findings; they never edit code, run migrations or touch data.
- **UI/UX reviews:** `loopin-ux-reviewer` looks at real screenshots or rendered pages (Read shows images). It says which screens it actually viewed. It never claims interactive testing it did not run.
- **Exceptional:** `loopin-deep-investigator` (fable, read-only) only after an Opus pass, or when the founder asks. If Fable refuses or is unavailable (its safeguards can decline some security detail), fall back to `opus` and say so.

## 3. Rules that always apply

- Never deploy, commit, push, merge, run a database migration, or change production data without the founder's explicit go-ahead in this conversation. That applies to every agent.
- Tests and audits use throwaway copies only, never the live database.
- Never print or ask for secrets, tokens, passwords or OTPs.
- Loopin's own skills still apply inside every agent:
  - `loopin-money-maths` for money
  - `loopin-premium-bar` and `loopin-calm-ux` for screens
  - `loopin-real-world` for privacy and locale
  - `loopin-smart-and-safe` for automatic or generated content

## 4. Saying what ran

- Name the agent and model in one short line when it helps, e.g. "Routing to loopin-auditor (opus): touches settlement."
- Report what actually ran, not what was planned:
  - If a call fell back to another model, or an agent was unavailable and the work was done inline, say so plainly.
  - Proof of the model: the Agent tool result names the agent; a headless run with `claude -p --output-format json` lists `modelUsage` with the real model IDs; `/cost` and the session transcript show usage per model.
- Never claim a model, a test run, a screenshot check or a review that didn't happen.
