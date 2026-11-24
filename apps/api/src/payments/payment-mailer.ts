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

export interface ReservationCreatedSellerEmailParams {
  toEmail: string;
  sellerName: string;
  buyerName: string;
  listingTitle: string;
  orderCode: string;
  quantity: number;
  totalPrice: number;
  pickupWindow: string;
  reservationId: string;
}

export interface ReservationCreatedBuyerEmailParams {
  toEmail: string;
  buyerName: string;
  sellerName: string;
  listingTitle: string;
  orderCode: string;
  quantity: number;
  pickupWindow: string;
  pickupAddress: string;
  reservationId: string;
}

export interface NearbyListingAlertEmailParams {
  toEmail: string;
  recipientName: string;
  listingId: string;
  listingTitle: string;
  sellerName: string;
  price: number;
  quantityAvailable: number;
  pickupWindow: string;
  distanceKm: number;
}

export interface PaymentMailer {
  sendProofSubmittedToSeller(params: ProofSubmittedEmailParams): Promise<void>;
  sendPaymentConfirmedToBuyer(params: PaymentConfirmedEmailParams): Promise<void>;
  sendPaymentRejectedToBuyer(params: PaymentRejectedEmailParams): Promise<void>;
  sendReservationCreatedToSeller(params: ReservationCreatedSellerEmailParams): Promise<void>;
  sendReservationCreatedToBuyer(params: ReservationCreatedBuyerEmailParams): Promise<void>;
  sendNearbyListingAlert(params: NearbyListingAlertEmailParams): Promise<void>;
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

  async sendReservationCreatedToSeller(params: ReservationCreatedSellerEmailParams): Promise<void> {
    const priceText = params.totalPrice === 0 ? '0đ (Miễn phí)' : formatVnd(params.totalPrice);
    const url = `${this.appPublicUrl}/sell/orders`;
    const subject = `[SaveMeal] Có đơn đặt mới ${params.orderCode} - ${params.listingTitle}`;
    const text = [
      `Xin chào ${params.sellerName},`,
      '',
      `${params.buyerName} vừa đặt ${params.quantity} phần "${params.listingTitle}" (mã đơn ${params.orderCode}).`,
      `Tổng tiền: ${priceText}`,
      `Khung giờ nhận: ${params.pickupWindow}`,
      '',
      `Xem đơn bán trên SaveMeal: ${url}`,
    ].join('\n');
    const html = buildHtmlEmail(
      `Đơn đặt mới ${params.orderCode}`,
      [
        `Xin chào <strong>${escapeHtml(params.sellerName)}</strong>,`,
        `<strong>${escapeHtml(params.buyerName)}</strong> vừa đặt <strong>${params.quantity} phần</strong> "${escapeHtml(params.listingTitle)}" với mã đơn <strong>${escapeHtml(params.orderCode)}</strong>.`,
        `Tổng tiền: <strong>${escapeHtml(priceText)}</strong><br/>Khung giờ nhận: <strong>${escapeHtml(params.pickupWindow)}</strong>`,
        'Hãy chuẩn bị phần ăn và xác nhận bàn giao khi người mua xuất trình mã QR hoặc mã đơn.',
      ],
      'Xem đơn bán',
      url,
    );

    await this.sendBestEffort(params.toEmail, subject, text, html, 'reservation_created_seller');
  }

  async sendReservationCreatedToBuyer(params: ReservationCreatedBuyerEmailParams): Promise<void> {
    const url = `${this.appPublicUrl}/orders/${params.reservationId}`;
    const subject = `[SaveMeal] Đặt giữ thành công đơn ${params.orderCode} - ${params.listingTitle}`;
    const text = [
      `Xin chào ${params.buyerName},`,
      '',
      `Bạn đã đặt giữ thành công ${params.quantity} phần "${params.listingTitle}" từ ${params.sellerName} (mã đơn ${params.orderCode}).`,
      `Khung giờ nhận: ${params.pickupWindow}`,
      `Địa điểm nhận: ${params.pickupAddress}`,
      '',
      `Mở mã QR nhận món: ${url}`,
    ].join('\n');
    const html = buildHtmlEmail(
      `Đặt giữ thành công đơn ${params.orderCode}`,
      [
        `Xin chào <strong>${escapeHtml(params.buyerName)}</strong>,`,
        `Bạn đã đặt giữ thành công <strong>${params.quantity} phần</strong> "${escapeHtml(params.listingTitle)}" từ <strong>${escapeHtml(params.sellerName)}</strong> (mã đơn <strong>${escapeHtml(params.orderCode)}</strong>).`,
        `Khung giờ nhận: <strong>${escapeHtml(params.pickupWindow)}</strong><br/>Địa điểm nhận: <strong>${escapeHtml(params.pickupAddress)}</strong>`,
        'Hãy mở đơn hàng để xuất trình mã QR hoặc mã đơn khi đến nhận món.',
      ],
      'Xem mã QR nhận món',
      url,
    );

    await this.sendBestEffort(params.toEmail, subject, text, html, 'reservation_created_buyer');
  }

  async sendNearbyListingAlert(params: NearbyListingAlertEmailParams): Promise<void> {
    const priceText = params.price === 0 ? 'Miễn phí' : formatVnd(params.price);
    const distanceText = `~${params.distanceKm.toFixed(1)} km`;
    const url = `${this.appPublicUrl}/listings/${params.listingId}`;
    const subject = `[SaveMeal] Món mới gần bạn (${distanceText}): ${params.listingTitle}`;
    const text = [
      `Xin chào ${params.recipientName},`,
      '',
      `${params.sellerName} vừa đăng "${params.listingTitle}" cách khu vực bạn chọn ${distanceText}.`,
      `Giá: ${priceText} · Số lượng: ${params.quantityAvailable} phần`,
      `Khung giờ nhận: ${params.pickupWindow}`,
      '',
      `Xem chi tiết món: ${url}`,
    ].join('\n');
    const html = buildHtmlEmail(
      `Món mới gần bạn (${distanceText})`,
      [
        `Xin chào <strong>${escapeHtml(params.recipientName)}</strong>,`,
        `<strong>${escapeHtml(params.sellerName)}</strong> vừa đăng <strong>${escapeHtml(params.listingTitle)}</strong> cách khu vực bạn chọn <strong>${escapeHtml(distanceText)}</strong>.`,
        `Giá: <strong>${escapeHtml(priceText)}</strong> · Số lượng: <strong>${params.quantityAvailable} phần</strong><br/>Khung giờ nhận: <strong>${escapeHtml(params.pickupWindow)}</strong>`,
        'Bạn có thể tắt thông báo món gần đây bất cứ lúc nào trong phần Cài đặt trên SaveMeal.',
      ],
      'Xem chi tiết món',
      url,
    );

    await this.sendBestEffort(params.toEmail, subject, text, html, 'nearby_listing_alert');
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

  async sendReservationCreatedToSeller(params: ReservationCreatedSellerEmailParams): Promise<void> {
    const priceText = params.totalPrice === 0 ? '0đ (Miễn phí)' : formatVnd(params.totalPrice);
    this.logger.log(
      `[console PaymentMailer] reservation_created_seller → ${maskIdentifier(params.toEmail)} (order ${params.orderCode}, qty=${params.quantity}, ${priceText})`,
    );
  }

  async sendReservationCreatedToBuyer(params: ReservationCreatedBuyerEmailParams): Promise<void> {
    this.logger.log(
      `[console PaymentMailer] reservation_created_buyer → ${maskIdentifier(params.toEmail)} (order ${params.orderCode}, qty=${params.quantity})`,
    );
  }

  async sendNearbyListingAlert(params: NearbyListingAlertEmailParams): Promise<void> {
    const priceText = params.price === 0 ? 'Miễn phí' : formatVnd(params.price);
    this.logger.log(
      `[console PaymentMailer] nearby_listing_alert → ${maskIdentifier(params.toEmail)} (listing ${params.listingId}, ${priceText}, ~${params.distanceKm.toFixed(1)} km)`,
    );
  }
}
