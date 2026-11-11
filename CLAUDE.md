# Loopin: notes for Claude

## Model routing
At the start of each task, use the `loopin-model-router` skill (`.claude/skills/loopin-model-router/SKILL.md`) to pick the agent and model:

| Model | Use for | Agent |
|---|---|---|
| `haiku` | Docs and simple low-risk tasks | `loopin-docs-helper` |
| `sonnet` | Everyday coding, UI and tests | `loopin-implementer`, `loopin-verifier` |
| `opus` | Architecture, security and audits, money and settlement, complex bugs, full UX review, product strategy | `loopin-planner`, `loopin-auditor`, `loopin-ux-reviewer`, `loopin-product-strategist` |
| `fable` | Exceptional, unresolved critical investigations only | `loopin-deep-investigator` |

Rules:
- Don't escalate trivial tasks.
- Money, authorization, settlement, security and schema changes need an independent read-only review and executable tests before they're done.
- Audits and reviews are read-only.
- Say which agent and model ran, and any fallback.

## Always
- Never deploy, commit, push, merge, migrate a database or change production data without the founder's explicit go-ahead.
- Tests use throwaway copies only. Never print or ask for secrets.
- The founder is not a programmer. Write in plain English, and tell them first before building unless told to build.
