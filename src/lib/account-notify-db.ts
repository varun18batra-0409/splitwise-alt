import { db } from "./db";
import { isKnownKey, setPref, type Channel } from "./account-notify";

// Saves one "Notifications & email" switch. The value is absolute ("on" or "off", never "toggle"), so a double tap
// or a retry says the same thing twice. Two switches saved at once can't undo each other: the new text is written only
// if the old text is still what is stored, and tried again if it changed in between.
export async function saveAccountPref(accountId: string, channel: Channel, key: string, on: boolean): Promise<{ ok: true; prefs: string } | { ok: false; error: string }> {
  if (!isKnownKey(channel, key)) return { ok: false, error: "That switch isn’t there any more." };
  for (let i = 0; i < 5; i++) {
    const row = await db.account.findUnique({ where: { id: accountId }, select: { notifyPrefs: true } });
    if (!row) return { ok: false, error: "Sign in again to change this." };
    const next = setPref(row.notifyPrefs, channel, key, on);
    if (next === row.notifyPrefs) return { ok: true, prefs: next };
    const done = await db.account.updateMany({ where: { id: accountId, notifyPrefs: row.notifyPrefs }, data: { notifyPrefs: next } });
    if (done.count === 1) return { ok: true, prefs: next };
  }
  return { ok: false, error: "Couldn’t save that. Try again." };
}
