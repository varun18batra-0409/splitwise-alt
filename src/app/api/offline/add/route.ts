import { after, type NextRequest } from "next/server";
import { addExpenseChecks } from "@/lib/add-expense-checks";
import { getMyMemberId } from "@/lib/identity";
import { clientIp } from "@/lib/rate-limit";
import { getRateOn } from "@/lib/rate-cache";
import { sendDraft } from "@/lib/offline/send";
import { checkBudgets } from "@/lib/home/budgets-db";
import { ownOrigin } from "@/lib/same-origin";
import { NOT_SIGNED_IN, OTHER_PERSON, offlineOn } from "@/lib/offline/words";
import { readDraft } from "@/lib/offline/validate";
import type { AddAnswer, AddRequest } from "@/lib/offline/types";

// An expense added offline, sent from the phone. A fixed web address (not a server action: action ids change with each release, and the
// offline screen on a phone can be older than the live app). It checks who is asking, then hands the typed values to saveExpense,
// the same function the Add screen uses, so every rule and all of the maths are the server's. It never saves anything differently.
export const dynamic = "force-dynamic";

const reply = (a: AddAnswer, status = 200) => Response.json(a, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(req: NextRequest) {
  if (!ownOrigin(req)) return reply({ status: "refused", code: "invalid", reason: "This request did not come from Loopin." }, 403);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return reply({ status: "refused", code: "invalid", reason: "Expected JSON." }, 415);
  if (!offlineOn()) return reply({ status: "later", reason: "Adding from the phone is switched off for now. Your expenses are kept on this phone." }, 503);

  let body: AddRequest;
  try {
    body = (await req.json()) as AddRequest;
  } catch {
    return reply({ status: "refused", code: "invalid", reason: "That wasn’t readable." }, 400);
  }
  const draft = readDraft(body?.draft);
  if (!draft) return reply({ status: "refused", code: "invalid", reason: "That expense wasn’t readable, so it wasn’t added." }, 400);
  const dryRun = body.dryRun === true;

  // Who you are comes from the cookie (never from the request); sendDraft refuses anyone but the person who saved the draft.
  const me = await getMyMemberId(draft.groupId);

  // Before anything about the group is looked at (so a stranger learns nothing about it, not even that it is a pair): not signed in here
  // keeps waiting; someone other than the person who saved it is refused.
  if (!me) return reply({ status: "later", reason: NOT_SIGNED_IN });
  if (me !== draft.memberId) return reply({ status: "refused", code: "other-person", reason: OTHER_PERSON });

  // The checks both doors share (rate limit; pairs are refused offline).
  const checks = await addExpenseChecks({ ip: clientIp(req.headers), groupId: draft.groupId, currency: draft.currency, editing: false, offline: true });
  if (!checks.ok) {
    if (checks.busy) return reply({ status: "later", reason: checks.error }, 429);
    return reply({ status: "refused", code: checks.pair ? "pair" : "invalid", reason: checks.error });
  }

  try {
    const answer = await sendDraft(draft, me, { dryRun, allowDuplicate: body.allowDuplicate === true, rateOn: (from, to, day) => getRateOn(from, to, day) });
    if (answer.status === "added" && !dryRun) after(() => checkBudgets(draft.groupId).catch(() => []));
    return reply(answer);
  } catch {
    // The database was busy or something unexpected: nothing is lost, the phone keeps it and tries again.
    return reply({ status: "later", reason: "Loopin is busy right now. Your expense is still on this phone." }, 503);
  }
}
