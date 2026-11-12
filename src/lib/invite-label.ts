// What to say next to a contact after a tap on one of their invite buttons. Opening WhatsApp or the messages app
// doesn't mean the message was sent (they may not press send), so only say what really happened.
// Email goes through Loopin, which reports the real result on the next screen: until then it's "Sending…".
export type InviteChannel = "whatsapp" | "sms" | "email";

export function inviteLabel(channel: InviteChannel): string {
  if (channel === "whatsapp") return "WhatsApp opened";
  if (channel === "sms") return "SMS opened";
  return "Sending the email…";
}
