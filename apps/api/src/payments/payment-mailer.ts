import { Injectable, Logger } from '@nestjs/common';
import { formatVnd } from '@savemeal/shared';
import { maskIdentifier } from '../auth/identifier';

export type FetchFn = typeof fetch;

export interface ProofSubmittedEmailParams {
  toEmail: string;
  sellerName: string;
  buyerName: string;
  listingTitle: string;
  orderCode: string;
  amount: number;
  reservationId: string;
}

export interface PaymentConfirmedEmailParams {
  toEmail: string;
  buyerName: string;
  sellerName: string;
  listingTitle: string;
  orderCode: string;
  amount: number;
  reservationId: string;
}

export interface PaymentRejectedEmailParams {
  toEmail: string;
  buyerName: string;
  sellerName: string;
  listingTitle: string;
  orderCode: string;
  amount: number;
  reason: string;
  reservationId: string;
}

export interface PaymentMailer {
  sendProofSubmittedToSeller(params: ProofSubmittedEmailParams): Promise<void>;
  sendPaymentConfirmedToBuyer(params: PaymentConfirmedEmailParams): Promise<void>;
  sendPaymentRejectedToBuyer(params: PaymentRejectedEmailParams): Promise<void>;
}

export const PAYMENT_MAILER = Symbol('PAYMENT_MAILER');

export interface ResendPaymentMailerOptions {
  apiKey: string;
  from: string;
  appPublicUrl: string;
  fetchFn?: FetchFn;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildHtmlEmail(heading: string, paragraphs: string[], ctaLabel: string, ctaUrl: string): string {
  const body = paragraphs
    .map((p) => `  <p style="margin: 0 0 12px; font-size: 15px; line-height: 1.5;">${p}</p>`)
    .join('\n');
  return [
    '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #1f2937;">',
    '  <h2 style="margin: 0 0 8px; font-size: 20px; color: #15803d;">SaveMeal</h2>',
    `  <h3 style="margin: 0 0 16px; font-size: 17px; color: #111827;">${escapeHtml(heading)}</h3>`,
    body,
    `  <p style="margin: 20px 0 12px;"><a href="${escapeHtml(ctaUrl)}" style="display: inline-block; padding: 10px 18px; background: #15803d; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600;">${escapeHtml(ctaLabel)}</a></p>`,
    '  <p style="margin: 16px 0 0; font-size: 12px; color: #6b7280;">Email tự động từ SaveMeal. Vui lòng không trả lời email này.</p>',
    '</div>',
  ].join('\n');
}

/**
 * Resend-backed transactional mailer for v1.3 P2P payment notifications.
 * Best-effort: network or HTTP failures are logged as warnings (with masked email) and never throw.
 */
export class ResendPaymentMailer implements PaymentMailer {
  private readonly logger = new Logger(ResendPaymentMailer.name);
  private readonly apiKey: string;
  private readonly from: string;
  private readonly appPublicUrl: string;
  private readonly fetchFn: FetchFn;

  constructor(options: ResendPaymentMailerOptions) {
    this.apiKey = options.apiKey;
    this.from = options.from;
    this.appPublicUrl = options.appPublicUrl.replace(/\/+$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async sendProofSubmittedToSeller(params: ProofSubmittedEmailParams): Promise<void> {
    const amountText = formatVnd(params.amount);
    const url = `${this.appPublicUrl}/sell/orders`;
    const subject = `[SaveMeal] Có biên lai chuyển khoản mới cho đơn ${params.orderCode}`;
    const text = [
      `Xin chào ${params.sellerName},`,
      '',
      `${params.buyerName} vừa gửi ảnh biên lai chuyển khoản (${amountText}) cho đơn ${params.orderCode} - "${params.listingTitle}".`,
      'Vui lòng kiểm tra tài khoản ngân hàng và xác nhận hoặc từ chối thanh toán trên SaveMeal.',
      '',
      `Mở SaveMeal: ${url}`,
    ].join('\n');
    const html = buildHtmlEmail(
      `Biên lai mới cho đơn ${params.orderCode}`,
      [
        `Xin chào <strong>${escapeHtml(params.sellerName)}</strong>,`,
        `<strong>${escapeHtml(params.buyerName)}</strong> vừa gửi ảnh biên lai chuyển khoản <strong>${escapeHtml(amountText)}</strong> cho đơn <strong>${escapeHtml(params.orderCode)}</strong> (${escapeHtml(params.listingTitle)}).`,
        'Vui lòng kiểm tra tài khoản ngân hàng của bạn và xác nhận để mở mã QR nhận món cho người mua.',
      ],
      'Kiểm tra đơn bán',
      url,
    );

    await this.sendBestEffort(params.toEmail, subject, text, html, 'proof_submitted');
  }

  async sendPaymentConfirmedToBuyer(params: PaymentConfirmedEmailParams): Promise<void> {
    const amountText = formatVnd(params.amount);
    const url = `${this.appPublicUrl}/orders/${params.reservationId}`;
    const subject = `[SaveMeal] Thanh toán đơn ${params.orderCode} đã được xác nhận`;
    const text = [
      `Xin chào ${params.buyerName},`,
      '',
      `${params.sellerName} đã xác nhận thanh toán ${amountText} cho đơn ${params.orderCode} - "${params.listingTitle}".`,
      'Mã QR nhận món của bạn đã sẵn sàng trên SaveMeal.',
      '',
      `Xem mã QR nhận món: ${url}`,
    ].join('\n');
    const html = buildHtmlEmail(
      `Thanh toán đơn ${params.orderCode} đã được xác nhận`,
      [
        `Xin chào <strong>${escapeHtml(params.buyerName)}</strong>,`,
        `<strong>${escapeHtml(params.sellerName)}</strong> đã xác nhận thanh toán <strong>${escapeHtml(amountText)}</strong> cho đơn <strong>${escapeHtml(params.orderCode)}</strong> (${escapeHtml(params.listingTitle)}).`,
        'Mã QR nhận món của bạn đã sẵn sàng. Hãy xuất trình mã QR hoặc mã đơn khi đến nhận món.',
      ],
      'Xem mã QR nhận món',
      url,
    );

    await this.sendBestEffort(params.toEmail, subject, text, html, 'payment_confirmed');
  }

  async sendPaymentRejectedToBuyer(params: PaymentRejectedEmailParams): Promise<void> {
    const amountText = formatVnd(params.amount);
    const url = `${this.appPublicUrl}/orders/${params.reservationId}`;
    const subject = `[SaveMeal] Thanh toán đơn ${params.orderCode} chưa được xác nhận`;
    const text = [
      `Xin chào ${params.buyerName},`,
      '',
      `${params.sellerName} chưa xác nhận thanh toán ${amountText} cho đơn ${params.orderCode} - "${params.listingTitle}".`,
      `Lý do: ${params.reason}`,
      'Đơn đã được hủy và phần ăn được trả lại suất.',
      '',
      `Xem chi tiết đơn: ${url}`,
    ].join('\n');
    const html = buildHtmlEmail(
      `Thanh toán đơn ${params.orderCode} bị từ chối`,
      [
        `Xin chào <strong>${escapeHtml(params.buyerName)}</strong>,`,
        `<strong>${escapeHtml(params.sellerName)}</strong> đã từ chối biên lai thanh toán <strong>${escapeHtml(amountText)}</strong> cho đơn <strong>${escapeHtml(params.orderCode)}</strong> (${escapeHtml(params.listingTitle)}).`,
        `Lý do: <strong>${escapeHtml(params.reason)}</strong>`,
        'Đơn đã được hủy và phần ăn đã được trả lại suất.',
      ],
      'Xem chi tiết đơn',
      url,
    );

    await this.sendBestEffort(params.toEmail, subject, text, html, 'payment_rejected');
  }

  private async sendBestEffort(
    toEmail: string,
    subject: string,
    text: string,
    html: string,
    kind: string,
  ): Promise<void> {
    try {
      const response = await this.fetchFn(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [toEmail],
          subject,
          text,
          html,
        }),
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) {
        let snippet = '';
        try {
          snippet = (await response.text()).slice(0, 200);
        } catch {
          snippet = '';
        }
        this.logger.warn(
          `Resend payment email (${kind}) failed for ${maskIdentifier(toEmail)} with status ${response.status}${snippet ? `: ${snippet}` : ''}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Resend payment email (${kind}) error for ${maskIdentifier(toEmail)}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}

/** Development/test fallback when Resend is not configured. */
@Injectable()
export class ConsolePaymentMailer implements PaymentMailer {
  private readonly logger = new Logger('PaymentMailer');

  async sendProofSubmittedToSeller(params: ProofSubmittedEmailParams): Promise<void> {
    this.logger.log(
      `[console PaymentMailer] proof_submitted → ${maskIdentifier(params.toEmail)} (order ${params.orderCode}, ${formatVnd(params.amount)})`,
    );
  }

  async sendPaymentConfirmedToBuyer(params: PaymentConfirmedEmailParams): Promise<void> {
    this.logger.log(
      `[console PaymentMailer] payment_confirmed → ${maskIdentifier(params.toEmail)} (order ${params.orderCode}, ${formatVnd(params.amount)})`,
    );
  }

  async sendPaymentRejectedToBuyer(params: PaymentRejectedEmailParams): Promise<void> {
    this.logger.log(
      `[console PaymentMailer] payment_rejected → ${maskIdentifier(params.toEmail)} (order ${params.orderCode}, reason=${params.reason})`,
    );
  }
}
