---
name: group-membership-permissions
description: Use when checking or changing who can join, see or do what in a Loopin group — membership, invites and join links, roles, people who left, were removed or are blocked, and who gets which notification.
---

# Group membership, invites, roles and notifications

Everything here is about who can see or change what, so it counts as risky work: plan first, build with tests, then an independent read-only review (`security-database-auditor` or `loopin-auditor`) and executable tests before it is done.

## Where it lives
- Membership and roles: `src/lib/membership.ts`, `group-admin.ts`, `owner.ts`, `people.ts`, `blocks.ts`, `left-view.ts`, `left-view-db.ts`, `leave-text.ts`.
- Invites and joining: `invites.ts`, `invitations.ts`, `invite-label.ts`, `join.ts`, `src/app/join/**`.
- Notifications: `notify-prefs.ts`, `push.ts`, `push-subs.ts`, `account-notify*.ts`, `needs-you.ts`, `nudge.ts`, `mail.ts`, `unsubscribe.ts`, `src/app/notifications/**`.
- Guards: every `src/app/*actions.ts` and `src/app/api/**/route.ts`.
- Existing tests: `tests/who-can-do-what.test.ts`, `membership`, `invites`, `invitations`, `pending-people`, `removed`, `left-view`, `blocked-invite-replies`, `leave-delete`, `notify-prefs`, `push-allowlist`, `policy-push-grants`; end-to-end `e2e/tests/11-groups`, `12-invites`, `39-left-view`.

## The people to check every action against
Signed-out visitor · pending member (invited, not joined) · member · group admin/owner · someone who left · someone removed · someone blocked by a member · a member of a different group.

For each action (view group, view an expense or photo, add/edit/delete an expense, record or confirm a payment, settle, invite, remove, close or reopen, rename, change currency, post a moment, react, report), write down who may do it, and check the server guard — not just a hidden button.

## Rules
- Every id in a request is checked against the caller's own membership on the server (no trusting ids from the page).
- People who left keep their history and see the group as it was when they left, read-only; they can't change money or settings, and they see nothing added after they left.
- Removed people lose access; rejoining needs a fresh invite.
- Invites: unguessable codes, expire, can be taken back, can't be reused to sneak back in after removal; blocked people can't invite or be invited by the person who blocked them.
- Notifications go only to current members who allow that kind, never show money or private content on a lock screen beyond what the preference allows, are never sent twice for one event, and respect mail and push limits (`rate-limit.ts`, mail budgets).
- Words: say plainly what happened ("Asha removed you from Goa trip"), never blame, never reveal who blocked whom.

## Done means
A test per rule that changed, including a must-fail test (the wrong person is refused), the who-can-do-what table updated, and the independent review passed.
