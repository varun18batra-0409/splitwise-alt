// When a sealed postcard opens, in the reader's own terms. It opens at midnight where the sender was (the start of the
// day they picked), which can be a different clock time for the reader: "Opens 1 January 2027 at 05:30 your time".
export function opensLine(opensAt: Date, tz: string): string {
  let zone = tz;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
  } catch {
    zone = "UTC";
  }
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: zone }).format(opensAt);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).format(opensAt);
  return `Opens ${date} at ${time} your time`;
}
