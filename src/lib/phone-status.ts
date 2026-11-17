// "This device": what the phone itself says about Loopin's notifications, in plain words.
// (Separate from "What Loopin sends", which is Loopin's own choices.)
export type PhoneState = "checking" | "unsupported" | "ios-install" | "denied" | "off" | "on" | "working";

export function phoneStatusLabel(state: PhoneState, permission: "default" | "granted" | "denied" | "none"): string {
  if (state === "checking") return "Checking…";
  if (state === "ios-install") return "Needs Loopin on your Home Screen"; // the box under it gives the steps, so the steps are not said twice
  if (state === "unsupported") return "Not available in this browser";
  if (state === "denied") return "Blocked in device settings";
  if (state === "on" || state === "working") return permission === "granted" ? "Allowed" : "Not asked yet";
  if (permission === "granted") return "Allowed, but turned off in Loopin";
  return "Not asked yet";
}
