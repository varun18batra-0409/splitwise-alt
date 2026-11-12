"use server";

import { db } from "@/lib/db";
import { redirect } from "@/lib/fresh-redirect";
import { getAccount } from "@/lib/identity";
import { allow, clientIp } from "@/lib/rate-limit";
import { safePath } from "@/lib/paths";
import { headers } from "next/headers";
import { blockAccount, sharesGroup, unblockAccount } from "@/lib/blocks";
import { isOwner } from "@/lib/owner";
import { appUrl, mailOperator } from "@/lib/ops-mail";
import { REPORT_KINDS, REPORT_REASONS, resolveReportTarget, saveSupportMessage } from "@/lib/reports";

const field = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").replace(/\r/g, "").slice(0, max);
const ID = /^[A-Za-z0-9_-]{6,40}$/;
const ANON_SUPPORT_PER_DAY = 100;

// "Report": a short form (a reason and an optional note). Saved first, then the operator is emailed (no photos in the email).
export async function reportAction(f: FormData) {
  const kind = field(f, "kind", 20);
  const id = field(f, "id", 40);
  const back = safePath(field(f, "back", 300));
  const here = `/report?${new URLSearchParams({ kind, id, back })}`;
  const me = await getAccount();
  if (!me) redirect(`/signin?back=${encodeURIComponent(here)}`);
  const fail = (error: string) => redirect(`${here}&${new URLSearchParams({ error })}`);
  const reason = field(f, "reason", 10);
  if (!(REPORT_KINDS as readonly string[]).includes(kind) || !ID.test(id)) fail("We couldn’t find that to report.");
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) fail("Pick what’s wrong.");
  const target = await resolveReportTarget(me!.id, kind, id);
  if (!target) fail("We couldn’t find that to report.");
  if (!(await allow(`report:${me!.id}`, 20, 86_400))) fail("That’s a lot of reports today. We’ll look at the ones you sent.");
  const note = field(f, "note", 500).trim();
  // The same open report from the same person isn't piled up twice; they still see the thanks.
  const already = await db.report.findFirst({ where: { reporterId: me!.id, kind, targetId: id, status: "open" }, select: { id: true } });
  if (!already) {
    await db.report.create({ data: { reporterId: me!.id, kind, targetId: id, targetAccountId: target!.accountId, reason, note } });
    // The reporter's own words stay in the app (owner-only page); the email only says a report came in.
    await mailOperator("Loopin: a new report to look at", ["A new report came in on Loopin.", "", `Open it (owner only): ${appUrl()}/stats/reports`]);
  }
  redirect(`${here}&done=1`);
}

// "Block": they can't send postcards, passports or nudges, and you stop seeing their cards and passport. Shared groups are untouched.
export async function blockAction(f: FormData) {
  const me = await getAccount();
  const accountId = field(f, "accountId", 40);
  if (!me) redirect(`/signin?back=${encodeURIComponent(safePath(field(f, "back", 300)))}`);
  if (!ID.test(accountId) || accountId === me!.id) redirect("/account");
  // Only someone you know: you share (or shared) a group, or they sent you a postcard.
  const known = (await sharesGroup(me!.id, accountId)) || Boolean(await db.postcard.findFirst({ where: { fromId: accountId, toId: me!.id }, select: { id: true } }));
  if (known) await blockAccount(me!.id, accountId);
  redirect("/account?blocked=1#blocked");
}

export async function unblockAction(f: FormData) {
  const me = await getAccount();
  if (!me) redirect("/signin?back=/account");
  const accountId = field(f, "accountId", 40);
  if (ID.test(accountId)) await unblockAccount(me!.id, accountId);
  redirect("/account?unblocked=1#blocked");
}

// Owner only: mark a report as dealt with.
export async function resolveReportAction(f: FormData) {
  const me = await getAccount();
  if (!isOwner(me)) redirect("/");
  const id = field(f, "id", 40);
  if (ID.test(id)) await db.report.updateMany({ where: { id, status: "open" }, data: { status: "resolved", resolvedAt: new Date() } });
  redirect("/stats/reports");
}

// "Contact support" when no support email is set: a short message that goes to the operator.
export async function contactSupportAction(f: FormData) {
  const me = await getAccount();
  const message = field(f, "message", 1500).trim();
  const reply = field(f, "reply", 120).trim();
  const fail = (error: string) => redirect(`/support?${new URLSearchParams({ error })}`);
  if (message.length < 5) fail("Write a few words so we know how to help.");
  if (reply && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reply)) fail("That email doesn’t look right. Check it, or leave it empty.");
  if (!(await allow(`support:${me?.id ?? clientIp(await headers())}`, 5, 3600))) fail("You’ve sent a few already. We’ll get back to you.");
  // Saved first: the message is kept even if the email below can't be sent (down, or over its daily allowance).
  // People who aren't signed in also share one app-wide allowance, so the table can't be flooded from many addresses.
  if (!me && !(await allow("support:anon-day", ANON_SUPPORT_PER_DAY, 86_400))) fail("We’re getting a lot of messages right now. Please try again tomorrow.");
  await saveSupportMessage({ reporterId: me?.id, message, contact: reply });
  await mailOperator("Loopin: a message for support", [
    "Someone wrote to Loopin support.",
    me ? `Signed in as: ${me.email}` : "Not signed in.",
    reply ? `Reply to: ${reply}` : "",
    "",
    message,
    "",
    `Also saved (owner only): ${appUrl()}/stats/reports`,
  ]);
  redirect("/support?sent=1");
}
