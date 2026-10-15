import { cookies } from "next/headers";
import { DEFAULT_TIME_ZONE, isTimeZone } from "./dates";

// The viewer's time zone, sent by their phone (see TimeZoneSync).
export async function getTimeZone(): Promise<string> {
  const tz = (await cookies()).get("tz")?.value;
  let decoded = "";
  try {
    decoded = tz ? decodeURIComponent(tz) : "";
  } catch {
    /* bad cookie: use the default */
  }
  return isTimeZone(decoded) ? decoded : DEFAULT_TIME_ZONE;
}
