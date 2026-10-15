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
