"use server";

import { getAccount } from "@/lib/identity";
import { saveAccountPref } from "@/lib/account-notify-db";

// "Notifications & email": one switch, saved at once.
export async function setNotifyPref(channel: string, key: string, on: boolean): Promise<{ ok: boolean; error?: string }> {
  const account = await getAccount();
  if (!account) return { ok: false, error: "Sign in again to change this." };
  if (channel !== "push" && channel !== "email") return { ok: false, error: "That switch isn’t there any more." };
  const r = await saveAccountPref(account.id, channel, String(key).slice(0, 60), on === true);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
