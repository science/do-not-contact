/**
 * Email sender for opt-out requests using nodemailer
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean; // true for 465, false for 587
  user: string;
  sendAs?: string; // Gmail "send mail as" address
  password: string;
}

export interface Identity {
  fullName: string;
  salutation: string; // First name for friendly sign-off
  email: string;
  phone: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
}

let smtpSendAs: string | undefined;

export interface SendResult {
  orgName: string;
  toEmail: string;
  success: boolean;
  messageId?: string;
  error?: string;
}

let transporter: Transporter<SMTPTransport.SentMessageInfo> | null = null;

export function initEmailTransport(config: SmtpConfig): Transporter<SMTPTransport.SentMessageInfo> {
  if (transporter) return transporter;

  // Store sendAs for use in sendOptOutEmail
  smtpSendAs = config.sendAs;

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
  });

  return transporter;
}

export async function verifyTransport(): Promise<boolean> {
  if (!transporter) {
    throw new Error("Email transport not initialized");
  }

  try {
    await transporter.verify();
    return true;
  } catch {
    return false;
  }
}

export function generateOptOutMessage(orgName: string, identity: Identity): { subject: string; text: string; html: string } {
  const fullAddress = `${identity.address.street}, ${identity.address.city}, ${identity.address.state} ${identity.address.zip}`;

  const subject = `Mailing list removal request - ${identity.fullName}`;

  const text = `Hi there,

Thank you for all the great work ${orgName} does! I really appreciate your mission and the impact you have.

I'm writing with a small request: would you mind removing me from your postal mailing list? I want to make sure your outreach budget goes to people who will respond, and I'm just not able to contribute right now.

If it helps to have my info for your records:
Name: ${identity.fullName}
Address: ${fullAddress}
Email: ${identity.email}
Phone: ${identity.phone}

Thanks so much for understanding, and keep up the wonderful work!

Warmly,
${identity.salutation}`;

  const html = `<p>Hi there,</p>

<p>Thank you for all the great work ${orgName} does! I really appreciate your mission and the impact you have.</p>

<p>I'm writing with a small request: would you mind removing me from your postal mailing list? I want to make sure your outreach budget goes to people who will respond, and I'm just not able to contribute right now.</p>

<p>If it helps to have my info for your records:<br>
Name: ${identity.fullName}<br>
Address: ${fullAddress}<br>
Email: ${identity.email}<br>
Phone: ${identity.phone}</p>

<p>Thanks so much for understanding, and keep up the wonderful work!</p>

<p>Warmly,<br>
${identity.salutation}</p>`;

  return { subject, text, html };
}

export async function sendOptOutEmail(
  orgName: string,
  toEmail: string,
  identity: Identity
): Promise<SendResult> {
  if (!transporter) {
    return {
      orgName,
      toEmail,
      success: false,
      error: "Email transport not initialized",
    };
  }

  const { subject, text, html } = generateOptOutMessage(orgName, identity);

  // Use sendAs address if configured (for Gmail "send mail as")
  const fromEmail = smtpSendAs || identity.email;

  try {
    const info = await transporter.sendMail({
      from: `"${identity.fullName}" <${fromEmail}>`,
      to: toEmail,
      subject,
      text,
      html,
    });

    return {
      orgName,
      toEmail,
      success: true,
      messageId: info.messageId,
    };
  } catch (err) {
    return {
      orgName,
      toEmail,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function sendTestEmail(
  toEmail: string,
  identity: Identity
): Promise<SendResult> {
  if (!transporter) {
    return {
      orgName: "TEST",
      toEmail,
      success: false,
      error: "Email transport not initialized",
    };
  }

  const fromEmail = smtpSendAs || identity.email;

  try {
    const info = await transporter.sendMail({
      from: `"${identity.fullName}" <${fromEmail}>`,
      to: toEmail,
      subject: "Test email from Do Not Contact app",
      text: `This is a test email to verify SMTP configuration.\n\nSending from: ${fromEmail}\nSending to: ${toEmail}\n\nIf you received this, the email setup is working!`,
      html: `<p>This is a test email to verify SMTP configuration.</p><p>Sending from: ${fromEmail}<br>Sending to: ${toEmail}</p><p>If you received this, the email setup is working!</p>`,
    });

    return {
      orgName: "TEST",
      toEmail,
      success: true,
      messageId: info.messageId,
    };
  } catch (err) {
    return {
      orgName: "TEST",
      toEmail,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function closeTransport(): void {
  if (transporter) {
    transporter.close();
    transporter = null;
  }
}
