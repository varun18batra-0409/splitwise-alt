import nodemailer, { type Transporter } from "nodemailer";

// Sends email through an SMTP account (for now: a Gmail address with an
// "app password"). Set SMTP_USER and SMTP_PASS in the hosting settings.

const outbox = () => process.env.MAIL_OUTBOX === "1" && process.env.NODE_ENV !== "development" && !process.env.VERCEL;

export function mailConfigured(): boolean {
  return outbox() || Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
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

export async function sendMail(to: string, subject: string, text: string, html: string): Promise<boolean> {
  if (!mailConfigured()) return false;
  if (outbox()) {
    // Automated tests: keep the email instead of sending it.
    const { db } = await import("./db");
    await db.outbox.create({ data: { to, subject, text } });
    return true;
  }
  // A daily ceiling for the whole app (Gmail allows ~500 a day), so nobody can
  // use up the quota and stop sign-in codes reaching everyone else.
  const { allow } = await import("./rate-limit");
  if (!(await allow("mail:all", Number(process.env.MAIL_DAILY_CAP ?? 400), 86_400))) {
    console.error("sendMail: daily email cap reached");
    await noteFailure("cap");
    return false;
  }
  if (!(await allow(`mail:to:${to.toLowerCase()}`, 10, 86_400))) return false; // one address can't be flooded
  const message = { from: process.env.MAIL_FROM ?? `Loopin <${process.env.SMTP_USER}>`, to, subject, text, html };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await transport().sendMail(message);
      return true;
    } catch (err) {
      // A kept connection the mail server dropped while idle: start a fresh one once.
      pooled?.close();
      pooled = null;
      if (attempt === 1) console.error("sendMail failed", err);
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
