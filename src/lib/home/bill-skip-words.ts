// The question asked before "Skip this time" on a bill: it names the bill and the month it means, in plain words.
// `period` is "2026-10"; with none (nothing to skip) it still reads sensibly ("that month").
export function skipAsk(billName: string, period: string): string {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? new Date(`${period}-15T12:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }) : "this time";
  return `Skip ${billName} for ${month}? It won’t be added for that month.`;
}
