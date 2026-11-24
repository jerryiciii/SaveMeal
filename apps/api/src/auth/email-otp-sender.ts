import { Logger } from '@nestjs/common';
import type { OtpChannel } from '@savemeal/shared';
import { AppException } from '../common/errors/app-exception';
import { maskIdentifier } from './identifier';
import type { OtpSender } from './otp-sender';

export type FetchFn = typeof fetch;

export interface ResendOtpSenderOptions {
  apiKey: string;
  from: string;
  fetchFn?: FetchFn;
}

export interface BrevoOtpSenderOptions {
  apiKey: string;
  senderEmail: string;
  senderName?: string;
  fetchFn?: FetchFn;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatOtpEmail(code: string): { subject: string; text: string; html: string } {
  const safeCode = escapeHtml(code);
  const subject = `Mã xác minh SaveMeal: ${code}`;
  const text = [
    `Mã xác minh SaveMeal của bạn là: ${code}`,
    '',
    'Mã có hiệu lực trong 5 phút. Vui lòng không chia sẻ mã này với bất kỳ ai.',
  ].join('\n');
  const html = [
    '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1f2937;">',
    '  <h2 style="margin: 0 0 12px; font-size: 20px; color: #15803d;">SaveMeal</h2>',
    '  <p style="margin: 0 0 16px; font-size: 15px;">Mã xác minh của bạn là:</p>',
    `  <div style="font-size: 32px; font-weight: 700; letter-spacing: 6px; padding: 16px; background: #f3f4f6; border-radius: 8px; text-align: center; margin-bottom: 16px;">${safeCode}</div>`,
    '  <p style="margin: 0 0 8px; font-size: 14px; color: #4b5563;">Mã có hiệu lực trong <strong>5 phút</strong>.</p>',
    '  <p style="margin: 0; font-size: 13px; color: #6b7280;">Vui lòng không chia sẻ mã này với bất kỳ ai. Nếu bạn không yêu cầu mã này, hãy bỏ qua email này.</p>',
    '</div>',
  ].join('\n');

  return { subject, text, html };
}

async function readErrorSnippet(response: Response): Promise<string> {
  try {
    const body = await response.text();
    return body.slice(0, 300);
  } catch {
    return '';
  }
}

/**
 * Email OTP sender backed by Resend REST API (POST https://api.resend.com/emails).
 * Pilot tier supports EMAIL channel only; SMS requests throw FEATURE_DISABLED.
 */
export class ResendOtpSender implements OtpSender {
  private readonly logger = new Logger(ResendOtpSender.name);
  private readonly apiKey: string;
  private readonly from: string;
  private readonly fetchFn: FetchFn;

  constructor(options: ResendOtpSenderOptions) {
    this.apiKey = options.apiKey;
    this.from = options.from;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async send(channel: OtpChannel, identifier: string, code: string): Promise<void> {
    if (channel !== 'EMAIL') {
      throw new AppException('FEATURE_DISABLED');
    }

    const { subject, text, html } = formatOtpEmail(code);
    let response: Response;
    try {
      response = await this.fetchFn(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [identifier],
          subject,
          text,
          html,
        }),
      });
    } catch (err) {
      this.logger.error(
        `Resend OTP request failed for ${maskIdentifier(identifier)}: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw new AppException('INTERNAL');
    }

    if (!response.ok) {
      const snippet = await readErrorSnippet(response);
      this.logger.error(
        `Resend OTP failed for ${maskIdentifier(identifier)} with status ${response.status}${snippet ? `: ${snippet}` : ''}`,
      );
      throw new AppException('INTERNAL');
    }
  }
}

/**
 * Email OTP sender backed by Brevo Transactional Email API (POST https://api.brevo.com/v3/smtp/email).
 * Pilot tier supports EMAIL channel only; SMS requests throw FEATURE_DISABLED.
 */
export class BrevoOtpSender implements OtpSender {
  private readonly logger = new Logger(BrevoOtpSender.name);
  private readonly apiKey: string;
  private readonly senderEmail: string;
  private readonly senderName: string;
  private readonly fetchFn: FetchFn;

  constructor(options: BrevoOtpSenderOptions) {
    this.apiKey = options.apiKey;
    this.senderEmail = options.senderEmail;
    this.senderName = options.senderName ?? 'SaveMeal';
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async send(channel: OtpChannel, identifier: string, code: string): Promise<void> {
    if (channel !== 'EMAIL') {
      throw new AppException('FEATURE_DISABLED');
    }

    const { subject, text, html } = formatOtpEmail(code);
    let response: Response;
    try {
      response = await this.fetchFn(BREVO_ENDPOINT, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: this.senderName, email: this.senderEmail },
          to: [{ email: identifier }],
          subject,
          textContent: text,
          htmlContent: html,
        }),
      });
    } catch (err) {
      this.logger.error(
        `Brevo OTP request failed for ${maskIdentifier(identifier)}: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw new AppException('INTERNAL');
    }

    if (!response.ok) {
      const snippet = await readErrorSnippet(response);
      this.logger.error(
        `Brevo OTP failed for ${maskIdentifier(identifier)} with status ${response.status}${snippet ? `: ${snippet}` : ''}`,
      );
      throw new AppException('INTERNAL');
    }
  }
}
