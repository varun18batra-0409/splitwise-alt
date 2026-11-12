import nodemailer, { type Transporter } from "nodemailer";

// Sends email through an SMTP account: Resend (SMTP_HOST=smtp.resend.com,
// SMTP_USER=resend, SMTP_PASS=its API key) or a Gmail address with an "app
// password" (the default host). Set these in the hosting settings.

const outbox = () => process.env.MAIL_OUTBOX === "1" && process.env.NODE_ENV !== "development" && !process.env.VERCEL;

// Addresses ending in ".test" can never receive email (the name is reserved
// for testing). Automated tests on the private test copy use them: there the
// email is kept in the database for the test to read; on the live app it is
// simply not sent (no bounces to hurt the sender's reputation).
const isTestAddress = (to: string) => /\.test$/i.test(to.trim());
const testCopy = () => process.env.VERCEL_ENV === "preview";

export function mailConfigured(): boolean {
  return outbox() || testCopy() || Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

// One connection, reused while the server is warm (a new secure connection to
// the mail server for every email took a second or more).
let pooled: Transporter | null = null;
function transport() {
  if (!pooled) {
    const port = Number(process.env.SMTP_PORT ?? 465);
    pooled = nodemailer.createTransport({
      pool: true,
      maxConnections: 2,
      host: process.env.SMTP_HOST ?? "smtp.gmail.com",
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return pooled;
}

// `signInCode`: sign-in codes always get through first. Everything else
// (invites, "you were added") stops a little before the daily ceiling, so a
// burst of invites can never lock people out of signing in.
export const OPS_MAIL_PER_DAY = 20;
export async function sendMail(to: string, subject: string, text: string, html: string, opts: { signInCode?: boolean; optOut?: boolean; item?: string; ops?: boolean } = {}): Promise<boolean> {
  if (!mailConfigured()) return false;
  // An optional email that belongs to a "Notifications & email" switch: skipped (reported as sent, like an unsubscribe,
  // so the sender learns nothing about the other person) when that person's account has it off.
  // Sign-in codes and security emails never pass `item`, so they are never held back. No account yet = today's behaviour.
  if (opts.item && !opts.signInCode) {
    const { db } = await import("./db");
    const { allows } = await import("./account-notify");
    // If the choices can't be read, an optional email isn't sent (never fail open).
    const acc = await db.account.findUnique({ where: { email: to.trim().toLowerCase() }, select: { notifyPrefs: true } }).then((a) => a ?? false, () => null);
    if (acc === null) return false;
    if (acc && !allows(acc.notifyPrefs, "email", opts.item)) return true;
  }
  // Invites and "you were added": skipped for people who unsubscribed, and carry an unsubscribe link.
  let list: { unsubscribe: { url: string; comment: string } } | undefined;
  if (opts.optOut) {
    const { db } = await import("./db");
    // If the opt-out list can't be checked, an optional email isn't sent (never fail open).
    const opted = await db.emailOptOut.findUnique({ where: { email: to.trim().toLowerCase() } }).then(Boolean, () => null);
    if (opted === null) return false;
    if (opted) return true;
    const { unsubscribeUrl } = await import("./unsubscribe");
    const url = await unsubscribeUrl(to);
    list = { unsubscribe: { url, comment: "Stop Loopin invite emails" } };
    text += `\n\n—\nDon’t want emails like this? ${url}`;
    html += `<p style="font-family:system-ui,sans-serif;font-size:12px;color:#888;margin-top:28px">Don’t want emails like this? <a href="${url}" style="color:#888">Stop them</a>.</p>`;
  }
  if (isTestAddress(to) && !outbox()) {
    if (!testCopy()) return true; // live app: never sent, never stored
    const { db } = await import("./db");
    await db.outbox.create({ data: { to, subject, text } });
    return true;
  }
  if (outbox()) {
    // Automated tests: keep the email instead of sending it.
    const { db } = await import("./db");
    await db.outbox.create({ data: { to, subject, text } });
    return true;
  }
  const { allow } = await import("./rate-limit");
  // One address can't be flooded. Sign-in codes have their own allowance, so
  // invitations from other people can never use up someone's sign-in.
  // Checked BEFORE the app-wide daily ceiling: an email refused here is never sent,
  // so it must not use up a place meant for emails that are (otherwise repeated
  // invites to one address could use the whole day's budget and block sign-in codes).
  // Mail to the operator (reports, support) is a small budget of its own: 20 a day in all (each address is one send).
  // It is NOT counted against the invite budget (mail:other) nor the app-wide count (mail:all), so a flood of reports
  // can never use up invitations or the 30 places kept for sign-in codes. (Everything is saved in the app anyway.)
  const [capKey, capMax]: [string, number] = opts.ops ? ["mail:ops", OPS_MAIL_PER_DAY] : [`${opts.signInCode ? "mail:code" : "mail:to"}:${to.toLowerCase()}`, opts.signInCode ? 12 : 10];
  if (!(await allow(capKey, capMax, 86_400))) return false;
  // A daily ceiling for the whole app, so nobody can use up the quota and stop
  // sign-in codes reaching everyone else. Under the sending service's own limit:
  // Resend's free plan allows 100 a day, Gmail about 500. (MAIL_DAILY_CAP overrides.)
  const cap = Number(process.env.MAIL_DAILY_CAP ?? (/resend/i.test(process.env.SMTP_HOST ?? "") ? 95 : 400));
  if (!opts.signInCode && !opts.ops && !(await allow("mail:other", Math.max(1, cap - 30), 86_400))) {
    console.error("sendMail: daily cap for invites reached (kept for sign-in codes)");
    await noteFailure("cap");
    return false;
  }
  if (!opts.ops && !(await allow("mail:all", cap, 86_400))) {
    console.error("sendMail: daily email cap reached");
    await noteFailure("cap");
    return false;
  }
  const message = {
    from: process.env.MAIL_FROM ?? `Loopin <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html,
    ...(list ? { list, headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await transport().sendMail(message);
      return true;
    } catch (err) {
      // A kept connection the mail server dropped while idle: start a fresh one once.
      pooled?.close();
      pooled = null;
      if (attempt === 1) console.error("sendMail failed:", (await import("./scrub")).safeErrorNote(err));
    }
  }
  await noteFailure("send");
  return false;
}

// A failed email is counted (when and why, never to whom), so the live stats
// can show whether sign-in codes and invites are getting out.
async function noteFailure(why: "send" | "cap") {
  try {
    const { db } = await import("./db");
    await db.notifyLog.create({ data: { key: `mail-failed:${why}:${new Date().toISOString()}:${Math.random().toString(36).slice(2, 8)}` } });
  } catch {
    // counting must never get in the way
  }
}
