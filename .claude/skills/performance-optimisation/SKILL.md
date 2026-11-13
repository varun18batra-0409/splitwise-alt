---
name: performance-optimisation
description: Use when a Loopin page feels slow or a speed check misses its target — measure first, find the slow database calls, round trips and waits, fix the biggest one, and prove the gain with the same measurement.
---

# Performance

Measure, change one thing, measure again. Never guess, and never load-test production without the founder's go-ahead.

## Tools already in the repo
- Speed gates in CI: the Check job prints lines like "Home makes 32 database calls (target 25 or fewer)" and p95 times for Home and busy-trip Balances (`scripts/load.ts`, `scripts/load-gates.mjs`).
- `scripts/perf-audit.ts`, `scripts/prod-speed.mjs` (read-only timing of the live site), `src/lib/speed.ts`, `src/app/api/speed`, workflows `speed*.yml`.
- Tests that pin the number of database calls: `tests/speed*.test.ts`.

## Where time usually goes
- **Database round trips** (Turso is remote; each call costs tens of ms): N+1 loops, the same row read twice on one page, loaders that wait for each other. Fix with one query that fetches what the page needs, `Promise.all` for independent reads, and `select` of only the fields used.
- **Missing indexes**: check the query's `where` and `orderBy` against `prisma/schema.prisma`. Adding an index is a schema change — add-only, planned, and needs the founder's approval.
- **Too much work per request**: recomputing balances for every group on Home; heavy maths in a render. Move it behind a cached, invalidated value or compute once per request.
- **Client weight**: large client components, images not sized (`next/image` sizes), fonts. Keep `"use client"` to the parts that need it.
- **Concurrency**: many people at once on one trip — watch locks and transactions (`single-flight.ts`, `once.ts`, `charge-lock.ts`).

## Never trade correctness for speed
- Never cache private data in a shared or public cache (photos are `private, no-cache` with ETag).
- Never cache money in a way that can show a stale balance after a change.
- Money and permission code changes still need the independent review and full tests.

## Report
Before and after numbers from the same tool and the same data, what changed, and what is still over target.
