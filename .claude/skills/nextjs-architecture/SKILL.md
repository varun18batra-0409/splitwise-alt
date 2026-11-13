---
name: nextjs-architecture
description: Use when writing or reviewing Loopin code to keep sound Next.js 15, React 19 and TypeScript patterns — server-first pages, guarded server actions, pure money logic in src/lib, and the pitfalls this codebase has already hit.
---

# Next.js, React and TypeScript patterns for Loopin

Stack: Next.js 15 App Router, React 19, TypeScript 5.8 (strict), Prisma 6 on Turso (libsql), Vercel, private Vercel Blob, Vitest, Playwright.

## Shape of the code
- **Pages are server components** by default. Add `"use client"` only to the small part that needs state, effects or browser APIs; pass it plain data, never Prisma objects or functions that read the database.
- **Logic lives in `src/lib`** as plain functions that can be unit-tested without a database (`split.ts`, `balances.ts`, `settle.ts`); database access sits next to it in `*-db.ts`. Components only display.
- **Server actions** (`src/app/*actions.ts`) and **route handlers** (`src/app/api/**/route.ts`) always run in this order: who is signed in (`session.ts`) → are they allowed (`membership.ts`, `group-admin.ts`) → validate every field → do the work in a transaction → redirect or return a result with an `ok` field. Mutating routes check `same-origin.ts`.
- **Money** is whole minor units (`number`, never floats in maths), parsed with `parseAmount`, shown with `formatMoney` / `overviewMoney`. Display helpers never feed calculations.
- **Duplicates and races**: request keys (`FreshKey` + `once.ts`), `single-flight.ts`, transactions for anything that writes more than one row.
- **Redirects** only to our own paths (`fresh-redirect.ts`); never trust a `back` or `next` value.

## Pitfalls already hit here (don't repeat)
- `"error" in obj` doesn't narrow inferred object-literal unions — return `{ ok: true, … } | { ok: false, error }` and test `ok`.
- A variable used in an aliased condition can narrow to `never`; copy it to a const first.
- Hidden direction and line-separator characters must be written as `\u` escapes in source.
- A `required` radio inside a hidden fieldset silently blocks submit — use `noValidate` and check on submit with a spoken message.
- A controlled input that rewrites its value on focus loses the selection — select the whole value right after (the Record a payment amount box).
- Cutting strings by `.slice()` can split an emoji in half and crash logs — use `Array.from(str).slice()`.
- In Playwright `page.evaluate`, don't use named inner functions (the build adds a `__name` helper the browser doesn't have).

## Review checklist
Server-first? Guard order right on every action? Ids checked against the caller? Logic testable without a database? No floats in money? Errors say what to do? No new dependency without the founder's approval?
