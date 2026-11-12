import { sendMail } from "./mail";
import { ownerEmails } from "./owner";

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
export const appUrl = () => (process.env.APP_URL || "https://www.loopinapps.com").replace(/\/$/, "");

// An email to the operator (ADMIN_EMAIL), always sent: it is the "ops" item, which no one can switch off.
// Never carries a private photo: reports link to the owner-only page instead. Never throws.
export async function mailOperator(subject: string, lines: string[]): Promise<boolean> {
  const to = ownerEmails();
  if (!to.length) return false;
  const text = lines.join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px"><pre style="white-space:pre-wrap;font-size:14px">${esc(text)}</pre></div>`;
  let any = false;
  for (const addr of to) {
    try {
      if (await sendMail(addr, subject, text, html, { item: "ops" })) any = true;
    } catch {
      // the report is already saved; the email is best effort
    }
  }
  return any;
}
