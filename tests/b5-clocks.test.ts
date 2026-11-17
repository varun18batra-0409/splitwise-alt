import { describe, expect, it } from "vitest";
import { paidOnLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { pulseDayFor, pulseRunFor, pulseText, type PulseRun } from "@/lib/pulse";
import { localMinutes } from "@/lib/local-time";

// B5 part A: days and times as each reader sees them. Pure (no database). Every expected value is worked out by hand.

describe("OP-12: 'You said you paid on ...'", () => {
  // 2026-11-17 19:00 UTC is 19:00 on 17 Nov in London (winter time) and 00:30 on 18 Nov in India (UTC+5:30).
  const paidAt = new Date("2026-11-17T19:00:00Z");
  it("London reads 17 Nov, India reads 18 Nov", () => {
    expect(paidOnLabel(paidAt, "Europe/London")).toBe("17 Nov");
    expect(paidOnLabel(paidAt, "Asia/Kolkata")).toBe("18 Nov");
  });
});

describe("amounts in the trip message", () => {
  it("formatMoney prints whole rupees without .00", () => {
    expect(formatMoney(420000, "INR")).toBe("₹4,200"); // 420000 paise = 4200 rupees
    expect(formatMoney(620000, "INR")).toBe("₹6,200");
  });
});

// The two crons: the evening run at 16:00Z on 17 Nov 2026 and the morning run at 00:30Z on 18 Nov 2026.
const EVENING_RUN = Date.parse("2026-11-17T16:00:00Z");
const MORNING_RUN = Date.parse("2026-11-18T00:30:00Z");
// What one run says to a person at a fixed offset (hours from UTC): their local minute of day and local date, then the rule.
function told(run: PulseRun, offsetHours: number) {
  const local = new Date((run === "evening" ? EVENING_RUN : MORNING_RUN) + offsetHours * 3_600_000); // read with the UTC getters
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const r = pulseDayFor(run, minutes, local.toISOString().slice(0, 10));
  return r && { run, at: local.toISOString().slice(11, 16), ...r };
}
const bothRuns = (off: number) => [told("evening", off), told("morning", off)].filter(Boolean);

describe("SB-3: when each person is told about a trip day", () => {
  // Each zone is given exactly one of the two runs: one that lands 06:00-21:59 for them (never at night), nearest 19:00 for an
  // evening message ("today", 16:00-21:59) or 08:00 for a morning one ("yesterday", 06:00-15:59).
  // Worked by hand, local time = UTC time + offset (evening run 16:00Z on 17 Nov, morning run 00:30Z on 18 Nov):
  //   -12    evening 04:00 (night)        morning 12:30 on 17 Nov   -> morning run, tells 16 Nov
  //   -10    evening 06:00 on 17 Nov      morning 14:30            -> 06:00 is 2h from 08:00, 14:30 is 6h30 from it: evening run, tells 16 Nov
  //   -5     evening 11:00 (5h from 8:00) morning 19:30 (0h30 from 19:00) -> morning run, tells 17 Nov (today)
  //   -2     evening 14:00                morning 22:30 (too late)  -> evening run, tells 16 Nov
  //   -1     evening 15:00                morning 23:30 (night)     -> evening run, tells 16 Nov
  //    0     evening 16:00                morning 00:30 (night)     -> evening run, tells 17 Nov
  //   +1     evening 17:00                morning 01:30 (night)     -> evening run, tells 17 Nov
  //   +5.5   evening 21:30 (2h30 from 19:00) morning 06:00 on 18 Nov (2h from 08:00) -> morning run, tells 17 Nov
  //   +8     evening 00:00 on 18 Nov (night) morning 08:30         -> morning run, tells 17 Nov
  //   +12.75 evening 04:45 (night)        morning 13:15            -> morning run, tells 17 Nov
  //   +13.75 evening 05:45 (night)        morning 14:15            -> morning run, tells 17 Nov
  //   +14    evening 06:00 on 18 Nov (2h from 08:00) morning 14:30 (6h30) -> evening run, tells 17 Nov
  const table: [number, PulseRun, string, string, "today" | "yesterday"][] = [
    [-12, "morning", "12:30", "2026-11-16", "yesterday"],
    [-10, "evening", "06:00", "2026-11-16", "yesterday"],
    [-5, "morning", "19:30", "2026-11-17", "today"],
    [-2, "evening", "14:00", "2026-11-16", "yesterday"],
    [-1, "evening", "15:00", "2026-11-16", "yesterday"],
    [0, "evening", "16:00", "2026-11-17", "today"],
    [1, "evening", "17:00", "2026-11-17", "today"],
    [5.5, "morning", "06:00", "2026-11-17", "yesterday"],
    [8, "morning", "08:30", "2026-11-17", "yesterday"],
    [12.75, "morning", "13:15", "2026-11-17", "yesterday"],
    [13.75, "morning", "14:15", "2026-11-17", "yesterday"],
    [14, "evening", "06:00", "2026-11-17", "yesterday"],
  ];
  it.each(table)("UTC%s: only the %s run sends (at %s their time) and it tells %s (%s)", (off, run, at, day, when) => {
    expect(bothRuns(off)).toEqual([{ run, at, day, when }]);
  });
  it("every offset from UTC-12 to UTC+14 in quarter hours gets it from exactly one run, never from 22:00 to 05:59 their time", () => {
    for (let q = -48; q <= 56; q++) {
      const sent = bothRuns(q / 4) as { at: string }[];
      expect(sent, `UTC${q / 4}`).toHaveLength(1);
      expect(sent[0].at >= "06:00" && sent[0].at < "22:00", `UTC${q / 4} at ${sent[0].at}`).toBe(true);
    }
  });
  it("seen over a week of runs, each trip day is told exactly once (no gap, no repeat) at every offset", () => {
    for (let q = -48; q <= 56; q += 1) {
      const off = q / 4;
      const days: string[] = [];
      for (let d = 0; d < 7; d++) {
        for (const [run, base] of [["evening", EVENING_RUN], ["morning", MORNING_RUN]] as const) {
          const local = new Date(base + d * 86_400_000 + off * 3_600_000);
          const r = pulseDayFor(run, local.getUTCHours() * 60 + local.getUTCMinutes(), local.toISOString().slice(0, 10));
          if (r) days.push(r.day);
        }
      }
      expect(new Set(days).size, `UTC${off}`).toBe(days.length); // no day twice
      for (let i = 1; i < days.length; i++) expect(Date.parse(days[i]) - Date.parse(days[i - 1]), `UTC${off}`).toBe(86_400_000); // no day skipped
      expect(days.length).toBeGreaterThanOrEqual(6);
    }
  });
  it("the choice is made once per zone: pulseRunFor on the evening run's local minute", () => {
    expect(pulseRunFor(16 * 60)).toBe("evening"); // UTC+0: 16:00 here, the morning run is at 00:30
    expect(pulseRunFor(11 * 60)).toBe("morning"); // UTC-5: the morning run is 19:30
    expect(pulseRunFor(-60)).toBe("morning"); // a negative minute wraps to 23:00 (night here), so the morning run (07:30) is theirs
    expect(pulseRunFor(22 * 60)).toBe("morning"); // 22:00 is already too late; the morning run is 06:30
  });
  it("real zones read to the minute: Kathmandu +5:45, Chatham +13:45 (summer), Kiritimati +14", () => {
    expect(localMinutes(new Date(EVENING_RUN), "Asia/Kathmandu")).toBe(21 * 60 + 45); // 16:00Z + 5:45
    expect(localMinutes(new Date(MORNING_RUN), "Pacific/Chatham")).toBe(14 * 60 + 15); // 00:30Z + 13:45
    expect(localMinutes(new Date(EVENING_RUN), "Pacific/Kiritimati")).toBe(6 * 60); // 16:00Z + 14:00 = 06:00
    expect(localMinutes(new Date(MORNING_RUN), "Europe/London")).toBe(30); // winter time: 00:30
  });
  it("the Bali text: day 3 of 6, 300000 of 420000 paise is 71% so the top payer is named", () => {
    // 15 Nov start, 20 Nov end: 17 Nov is day 3 of 6. 300000 / 420000 = 0.714 which is at least 0.6.
    const o = { place: "Bali", day: 3, of: 6, spent: 420000, currency: "INR", count: 2, topPayer: "Bina", topShare: 300000 / 420000 };
    expect(pulseText(o)).toBe("Day 3 in Bali: ₹4,200 gone, Bina’s carrying the team 😅");
    expect(pulseText({ ...o, when: "yesterday" })).toBe("Day 3 in Bali: ₹4,200 gone, Bina’s carrying the team 😅"); // multi-day: same
  });
  it("a one-day trip: 'today' in the evening, 'yesterday' next morning", () => {
    const o = { place: "Goa", day: 1, of: 1, spent: 420000, currency: "INR", count: 2, topShare: 0.5 };
    expect(pulseText(o)).toBe("Goa today: ₹4,200 gone, 2 expenses, shared fair and square 🤝");
    expect(pulseText({ ...o, when: "yesterday" })).toBe("Goa yesterday: ₹4,200 gone, 2 expenses, shared fair and square 🤝");
  });
});
