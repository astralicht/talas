import { render } from '@react-email/render';
import { Resend } from 'resend';
import nodemailer, { type Transporter } from 'nodemailer';
import { getEnv } from '@/lib/env';
import { VerifyEmailEmail, verifyEmailText } from './templates/verify-email';
import { ResetPasswordEmail, resetPasswordText } from './templates/reset-password';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export class MemoryEmailSender implements EmailSender {
  readonly outbox: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.outbox.push(message);
  }

  clear(): void {
    this.outbox.length = 0;
  }
}

export class ResendEmailSender implements EmailSender {
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<void> {
    const env = getEnv();
    const result = await this.client.emails.send({
      from: env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (result.error) throw new Error(`Resend rejected the message: ${result.error.message}`);
  }
}

export class MailHogEmailSender implements EmailSender {
  private readonly transporter: Transporter;

  constructor(smtpUrl: string) {
    this.transporter = nodemailer.createTransport(smtpUrl);
  }

  async send(message: EmailMessage): Promise<void> {
    const env = getEnv();
    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }
}

export class EmailService {
  constructor(private readonly sender: EmailSender) {}

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    const env = getEnv();
    const url = `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
    const html = await render(<VerifyEmailEmail url={url} />);
    await this.sender.send({
      to,
      subject: 'Verify your Talas email',
      html,
      text: verifyEmailText(url),
    });
  }

  async sendPasswordResetEmail(to: string, token: string): Promise<void> {
    const env = getEnv();
    const url = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
    const html = await render(<ResetPasswordEmail url={url} />);
    await this.sender.send({
      to,
      subject: 'Reset your Talas password',
      html,
      text: resetPasswordText(url),
    });
  }
}

const globalForEmail = globalThis as unknown as {
  __talasMemoryEmail?: MemoryEmailSender;
  __talasEmailService?: EmailService;
};

export function getMemoryEmailSender(): MemoryEmailSender {
  if (!globalForEmail.__talasMemoryEmail) {
    globalForEmail.__talasMemoryEmail = new MemoryEmailSender();
  }
  return globalForEmail.__talasMemoryEmail;
}

export function createEmailSender(): EmailSender {
  const env = getEnv();
  if (env.EMAIL_TRANSPORT === 'memory') return getMemoryEmailSender();
  if (env.EMAIL_TRANSPORT === 'resend') {
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required for the resend transport');
    return new ResendEmailSender(env.RESEND_API_KEY);
  }
  return new MailHogEmailSender(env.MAILHOG_SMTP_URL);
}

export function getEmailService(): EmailService {
  if (!globalForEmail.__talasEmailService) {
    globalForEmail.__talasEmailService = new EmailService(createEmailSender());
  }
  return globalForEmail.__talasEmailService;
}

export function resetEmailServiceForTests(): void {
  delete globalForEmail.__talasEmailService;
  globalForEmail.__talasMemoryEmail?.clear();
  delete globalForEmail.__talasMemoryEmail;
}
