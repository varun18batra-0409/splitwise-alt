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

// The second line under a sealed card, said without repeating the sender's day ("Meera sealed this to open on 1 January 2027."):
//  - "" when it opens at midnight on that same day on the reader's clock too: nothing to add;
//  - "That’s 16:44 your time." when it is the same day but another clock time;
//  - "For you, that’s 31 December 2026 at 18:30." when the reader's clock is on a different day.
export function readerClock(opensAt: Date, tz: string, senderDay: string): string {
  let zone = tz;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
  } catch {
    zone = "UTC";
  }
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: zone }).format(opensAt);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).format(opensAt);
  if (date !== senderDay) return `For you, that’s ${date} at ${time}.`;
  return time === "00:00" ? "" : `That’s ${time} your time.`;
}
