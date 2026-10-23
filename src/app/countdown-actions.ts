"use server";

import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { todayKey } from "@/lib/dates";
import { allow } from "@/lib/rate-limit";
import { logEvent } from "@/lib/events";
import { countdownWords, tripPhase } from "@/lib/countdown";

// "Share with everyone in the trip": the countdown goes into the group's
// history, which shows in everyone's Alerts and buzzes their phones once
// (the same as any change in the group). Each share is one buzz; a few
// shares a day per person at most, so a stuck finger can't spam the group.
export async function shareCountdownInLoopin(groupId: string): Promise<{ ok: boolean; message: string }> {
  if (typeof groupId !== "string" || !/^[A-Za-z0-9_-]{6,40}$/.test(groupId)) return { ok: false, message: "That trip isn’t there any more." };
  const myId = await getMyMemberId(groupId);
  if (!myId) return { ok: false, message: "Only people in this trip can share it here." };
  const g = await db.group.findUnique({
    where: { id: groupId },
    select: { name: true, type: true, tripStart: true, tripEnd: true, deletedAt: true, members: { where: { id: myId, leftAt: null }, select: { id: true } } },
  });
  if (!g || g.deletedAt || !g.members.length) return { ok: false, message: "Only people in this trip can share it here." };
  const phase = tripPhase(g.tripStart, g.tripEnd, todayKey(new Date(), await getTimeZone()));
  const words = phase ? countdownWords(g.name, phase) : null;
  if (!words) return { ok: false, message: "This trip doesn’t have a countdown right now." };
  if (!(await allow(`countdown-share:${groupId}:${myId}`, 3, 24 * 3600))) return { ok: false, message: "You’ve shared it a few times today. Try again tomorrow." };
  await logEvent(db, { groupId, actorId: myId, kind: "countdown_shared", text: `is counting down: ${words.line}` });
  return { ok: true, message: "Sent to everyone in the trip ✓" };
}
