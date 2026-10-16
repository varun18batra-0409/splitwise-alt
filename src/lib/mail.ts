import nodemailer from "nodemailer";

// Sends email through an SMTP account (for now: a Gmail address with an
// "app password"). Set SMTP_USER and SMTP_PASS in the hosting settings.

const outbox = () => process.env.MAIL_OUTBOX === "1" && process.env.NODE_ENV !== "development" && !process.env.VERCEL;

export function mailConfigured(): boolean {
  return outbox() || Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
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
    return false;
  }
  if (!(await allow(`mail:to:${to.toLowerCase()}`, 10, 86_400))) return false; // one address can't be flooded
  const port = Number(process.env.SMTP_PORT ?? 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  try {
    await transport.sendMail({ from: process.env.MAIL_FROM ?? `Loopin <${process.env.SMTP_USER}>`, to, subject, text, html });
    return true;
  } catch (err) {
    console.error("sendMail failed", err);
    return false;
  }
}
