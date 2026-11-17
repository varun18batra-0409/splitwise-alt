// When a sealed postcard opens, in the reader's own terms. It opens at midnight where the sender was (the start of the
// day they picked), which can be a different clock time for the reader: "Opens 1 January 2027 at 05:30 your time" (and plain "Opens 1 January 2027" when it is midnight for the reader too).
// The day a sealed card opens, as the SENDER meant it ("1 January 2027"): in the sender's zone, which is where it opens at midnight.
// The sender's saved zone can be out of date if they have since moved; the reader still sees their own clock in `opensLine`.
// `senderTz` is "" or not a real zone when it isn't known: `fallbackTz` (the reader's) is used then.
export function sealedDay(opensAt: Date, senderTz: string | null | undefined, fallbackTz: string, style: "long" | "short" = "long"): string {
  const ok = (z: string | null | undefined): z is string => {
    if (!z) return false;
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: z });
      return true;
    } catch {
      return false;
    }
  };
  const zone = ok(senderTz) ? senderTz : ok(fallbackTz) ? fallbackTz : "UTC";
  return new Intl.DateTimeFormat("en-GB", style === "short" ? { day: "numeric", month: "short", timeZone: zone } : { day: "numeric", month: "long", year: "numeric", timeZone: zone }).format(opensAt);
}

export function opensLine(opensAt: Date, tz: string): string {
  let zone = tz;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
  } catch {
    zone = "UTC";
  }
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: zone }).format(opensAt);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).format(opensAt);
  // Midnight needs no time ("Opens 1 January 2027"); any other clock time is shown, because it is when the reader's own clock says it opens.
  return time === "00:00" ? `Opens ${date}` : `Opens ${date} at ${time} your time`;
}
