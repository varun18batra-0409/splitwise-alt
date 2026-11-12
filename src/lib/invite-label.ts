// What to say next to a contact after a tap on one of their invite buttons. Opening WhatsApp or the messages app
// doesn't mean the message was sent (they may not press send), so only say what really happened.
// Email goes through Loopin, which reports the real result on the next screen: until then it's "Sending…".
export type InviteChannel = "whatsapp" | "sms" | "email";

export function inviteLabel(channel: InviteChannel): string {
  if (channel === "whatsapp") return "WhatsApp opened";
  if (channel === "sms") return "SMS opened";
  return "Sending the email…";
}

// The notice after "invite by email". One wording for everyone, whoever the email belongs to (a reply that differed could show
// that someone blocked the inviter), and honest: the email goes out after the reply and Loopin cannot see if it arrives.
export function invitedNotice(email: string): string {
  return `We’re emailing an invitation${email ? ` to ${email}` : ""}. If it doesn’t arrive, share the invite link.`;
}

// The small line under an address typed on Add people, before it is added.
export const INVITE_EMAIL_HINT = "In the group now. We’ll email an invitation";
