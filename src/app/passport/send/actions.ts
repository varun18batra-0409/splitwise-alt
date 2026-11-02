"use server";

import { redirect } from "@/lib/fresh-redirect";
import { getAccount } from "@/lib/identity";
import { allow } from "@/lib/rate-limit";
import { deliverNotes } from "@/lib/account-notes";
import { canSendTo } from "@/lib/postcards/people";

// Send your passport to people you've shared a group with: each gets an alert that opens it.
export async function sendPassportAction(f: FormData) {
  const me = await getAccount();
  if (!me) redirect("/signin?back=/passport/send");
  if (me!.passportShare === "private") redirect("/passport/send?error=private");
  const to = await canSendTo(me!.id, [...new Set(f.getAll("to").map(String))].slice(0, 60));
  if (!to.size) redirect("/passport/send?error=none");
  if (!(await allow(`passport-send:${me!.id}`, 40, 86_400))) redirect("/passport/send?error=limit");
  const who = me!.name.trim().split(/\s+/)[0] || "A friend";
  await deliverNotes([{ accountIds: [...to], kind: "passport", title: `${who} sent you their passport`, body: "See where they’ve been.", url: `/passport/friends/${me!.id}`, tag: `passport-${me!.id}` }]);
  redirect(`/passport?sent=${to.size}`);
}
