// ============================================================================
// MAILER – plain SMTP through the academy's own mailbox (nodemailer).
// No email API service: mail goes from your mail server (e.g. the host of
// info@siloraacademy.com, or Gmail/Google Workspace with an app password).
//
// .env
//   SMTP_HOST=smtp.gmail.com        # your mailbox's SMTP server
//   SMTP_PORT=465                   # 465 = TLS, 587 = STARTTLS
//   SMTP_USER=info@siloraacademy.com
//   SMTP_PASS=<app password>        # never commit
//   MAIL_FROM="Silora Academy <info@siloraacademy.com>"   (optional)
// ============================================================================
import nodemailer from "nodemailer";

// Settings are read lazily: server.js loads .env after its imports run.
let cached;
function setup() {
  if (cached) return cached;
  const host = process.env.SMTP_HOST || "";
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const from = process.env.MAIL_FROM || process.env.PORTAL_MAIL_FROM || `Silora Academy <${user || process.env.MAIL_USER || "info@siloraacademy.com"}>`;
  const transport =
    host && user && pass
      ? nodemailer.createTransport({
          host,
          port,
          secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
          auth: { user, pass },
          pool: true,
          maxConnections: 3,
          connectionTimeout: 15000,
        })
      : null;
  cached = { transport, from };
  return cached;
}
export const mailConfigured = () => !!setup().transport;
export const defaultFrom = () => setup().from;

/**
 * Send an email. attachments: [{ filename, content (base64 string or Buffer), type? }]
 * Throws on failure (callers decide how to report it).
 */
export async function sendMail({ from, to, subject, html, replyTo, reply_to, attachments }) {
  const { transport, from: fallbackFrom } = setup();
  if (!transport) {
    const err = new Error("Email isn't configured on the server (SMTP_HOST / SMTP_USER / SMTP_PASS missing)");
    err.code = "MAIL_NOT_CONFIGURED";
    throw err;
  }
  const info = await transport.sendMail({
    from: from || fallbackFrom,
    to,
    subject,
    html,
    replyTo: replyTo || reply_to,
    attachments: (attachments || []).map((a) => ({
      filename: a.filename,
      content: Buffer.isBuffer(a.content) ? a.content : Buffer.from(String(a.content || ""), "base64"),
      contentType: a.type || a.contentType,
    })),
  });
  return { id: info.messageId };
}

/** Same as sendMail but returns { status, error? } instead of throwing. */
export async function trySendMail(opts) {
  if (!setup().transport) return { status: "skipped", error: "Email isn't configured on the server (SMTP settings missing)" };
  try {
    await sendMail(opts);
    return { status: "sent" };
  } catch (e) {
    return { status: "failed", error: `Mail server error: ${String(e.message || e).slice(0, 200)}` };
  }
}

/** Returns "ok" | "not_configured" | "error: <reason>" */
export async function verifyMail() {
  const { transport } = setup();
  if (!transport) return "not_configured";
  try {
    await transport.verify();
    return "ok";
  } catch (e) {
    const reason = /timeout|ETIMEDOUT|ECONNREFUSED/i.test(String(e.code || e.message))
      ? `can't reach ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 465} – the network or firewall is blocking mail ports`
      : /auth|535|credentials/i.test(String(e.code || e.message))
      ? "the mail server rejected the username/password"
      : e.message;
    return `error: ${reason}`;
  }
}
