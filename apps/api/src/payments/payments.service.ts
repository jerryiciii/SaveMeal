import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatOrderCode, type Payment, type Reservation } from '@savemeal/shared';
import type { AuthAccount } from '../auth/auth.guard';
import { AppException } from '../common/errors/app-exception';
import { logEvent } from '../common/event-log';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { computePickupTokenExpiry, generatePickupToken } from '../reservations/pickup-token';
import { RESERVATION_INCLUDE, toReservation } from '../reservations/reservation.mapper';
import type { RejectPaymentDto, SubmitPaymentProofDto } from './payment.dto';
import { PAYMENT_MAILER, type PaymentMailer } from './payment-mailer';
import { PAYMENT_INCLUDE, toPayment } from './payment.mapper';

type Tx = Prisma.TransactionClient;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ExpireScope = {
  listingId?: string;
  buyerId?: string;
  reservationId?: string;
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @Inject(PAYMENT_MAILER) private readonly mailer: PaymentMailer,
  ) {}

  // ------------------------------------------------------------------------------------------
  // Lazy-expiry & JOB-2 helper (D§6, v1.3)
  // ------------------------------------------------------------------------------------------

  /**
   * Atomically expires overdue PENDING_PAYMENT reservations (payment_expires_at <= now),
   * marks their UNPAID payment EXPIRED, and returns stock to PUBLISHED listings before pickupEnd.
   * Does NOT expire AWAITING_SELLER_CONFIRM reservations on the hold timer.
   */
  async expirePendingPayments(
    tx?: Tx,
    scope?: ExpireScope,
    now = new Date(),
  ): Promise<number> {
    if (tx) return this.expirePendingPaymentsInTx(tx, scope, now);
    return this.prisma.$transaction((innerTx) => this.expirePendingPaymentsInTx(innerTx, scope, now));
  }

  private async expirePendingPaymentsInTx(
    tx: Tx,
    scope: ExpireScope | undefined,
    now: Date,
  ): Promise<number> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`status = 'PENDING_PAYMENT'`,
      Prisma.sql`payment_expires_at IS NOT NULL`,
      Prisma.sql`payment_expires_at <= ${now}`,
    ];
    if (scope?.listingId) conditions.push(Prisma.sql`listing_id = ${scope.listingId}::uuid`);
    if (scope?.buyerId) conditions.push(Prisma.sql`buyer_id = ${scope.buyerId}::uuid`);
    if (scope?.reservationId) conditions.push(Prisma.sql`id = ${scope.reservationId}::uuid`);

    const expired = await tx.$queryRaw<
      { id: string; listing_id: string; seller_id: string; quantity: number }[]
    >`
      UPDATE reservations
         SET status = 'EXPIRED', closed_at = ${now}, updated_at = ${now}
       WHERE ${Prisma.join(conditions, ' AND ')}
      RETURNING id, listing_id, seller_id, quantity`;

    if (expired.length === 0) return 0;

    // Release stock per listing atomically (only if still PUBLISHED and before pickup_end).
    const stockByListing = new Map<string, number>();
    for (const row of expired) {
      stockByListing.set(row.listing_id, (stockByListing.get(row.listing_id) ?? 0) + row.quantity);
    }
    for (const [listingId, qty] of stockByListing) {
      await tx.$executeRaw`
        UPDATE food_listings
           SET quantity_available = quantity_available + ${qty}::int,
               updated_at = ${now}
         WHERE id = ${listingId}::uuid
           AND status = 'PUBLISHED'
           AND pickup_end > ${now}`;
    }

    const reservationIds = expired.map((r) => r.id);
    const idParams = reservationIds.map((id) => Prisma.sql`${id}::uuid`);
    const expiredPayments = await tx.$queryRaw<{ id: string; reservation_id: string }[]>`
      UPDATE payments
         SET status = 'EXPIRED', updated_at = ${now}
       WHERE reservation_id IN (${Prisma.join(idParams)})
         AND status = 'UNPAID'
      RETURNING id, reservation_id`;

    for (const p of expiredPayments) {
      await logEvent(tx, {
        actorId: null,
        actorType: 'SYSTEM',
        event: 'PAYMENT_EXPIRED',
        entityType: 'payment',
        entityId: p.id,
        data: { reservationId: p.reservation_id, reason: 'PAYMENT_HOLD_EXPIRED' },
      });
    }

    for (const row of expired) {
      await logEvent(tx, {
        actorId: null,
        actorType: 'SYSTEM',
        event: 'RESERVATION_EXPIRED',
        entityType: 'reservation',
        entityId: row.id,
        data: {
          listingId: row.listing_id,
          sellerId: row.seller_id,
          quantity: row.quantity,
          reason: 'PAYMENT_HOLD_EXPIRED',
        },
      });
    }

    return expired.length;
  }

  // ------------------------------------------------------------------------------------------
  // PAY-1 · GET /reservations/:reservationId/payment
  // ------------------------------------------------------------------------------------------

  async getForReservation(account: AuthAccount, reservationId: string): Promise<Payment> {
    await this.expirePendingPayments(undefined, { reservationId });

    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { payment: { include: PAYMENT_INCLUDE } },
    });
    if (!reservation) throw new AppException('RESERVATION_NOT_FOUND');

    const allowed =
      account.id === reservation.buyerId ||
      account.id === reservation.sellerId ||
      account.role === 'ADMIN';
    if (!allowed) throw new AppException('RESERVATION_NOT_FOUND');

    if (!reservation.payment) throw new AppException('PAYMENT_NOT_FOUND');
    return toPayment(reservation.payment);
  }

  // ------------------------------------------------------------------------------------------
  // PAY-2 · POST /reservations/:reservationId/payment-proof (BUYER)
  // ------------------------------------------------------------------------------------------

  async submitProof(
    account: AuthAccount,
    reservationId: string,
    dto: SubmitPaymentProofDto,
  ): Promise<Reservation> {
    const proofImageId = dto.proofImageId?.trim();
    if (!proofImageId) {
      throw new AppException('PROOF_REQUIRED');
    }
    if (!UUID_REGEX.test(proofImageId)) {
      throw new AppException('IMAGE_NOT_FOUND');
    }

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM reservations WHERE id = ${reservationId}::uuid FOR UPDATE`;
      await this.expirePendingPaymentsInTx(tx, { reservationId }, now);

      const row = await tx.reservation.findUnique({
        where: { id: reservationId },
        include: {
          payment: true,
          listing: { select: { title: true } },
          buyer: { select: { displayName: true } },
          seller: { select: { email: true, sellerName: true, displayName: true } },
        },
      });
      if (!row || row.buyerId !== account.id) throw new AppException('RESERVATION_NOT_FOUND');
      if (!row.payment) throw new AppException('PAYMENT_NOT_FOUND');
      if (row.status !== 'PENDING_PAYMENT' || row.payment.status !== 'UNPAID') {
        throw new AppException('PAYMENT_NOT_CONFIRMABLE');
      }

      const image = await tx.listingImage.findFirst({
        where: { id: proofImageId, uploaderId: account.id },
        select: { id: true, purpose: true },
      });
      if (!image) throw new AppException('IMAGE_NOT_FOUND');
      if (image.purpose !== 'PAYMENT_PROOF') {
        throw new AppException('VALIDATION_FAILED', {
          fields: { proofImageId: 'image must be uploaded with purpose PAYMENT_PROOF' },
        });
      }

      await tx.payment.update({
        where: { id: row.payment.id },
        data: {
          status: 'PROOF_SUBMITTED',
          proofImageId: image.id,
          proofSubmittedAt: now,
        },
      });

      const updated = await tx.reservation.update({
        where: { id: reservationId },
        data: { status: 'AWAITING_SELLER_CONFIRM' },
        include: RESERVATION_INCLUDE,
      });

      await logEvent(tx, {
        actorId: account.id,
        actorType: 'USER',
        event: 'PAYMENT_PROOF_SUBMITTED',
        entityType: 'payment',
        entityId: row.payment.id,
        data: {
          reservationId,
          proofImageId: image.id,
          amount: row.payment.amount,
        },
      });

      return {
        updated,
        sellerEmail: row.seller.email,
        sellerName: row.seller.sellerName ?? row.seller.displayName ?? 'Người bán',
        buyerName: row.buyer.displayName ?? 'Người mua',
        listingTitle: row.listing.title,
        orderCode: formatOrderCode(row.code),
        amount: row.payment.amount,
      };
    });

    if (result.sellerEmail) {
      await this.mailer.sendProofSubmittedToSeller({
        toEmail: result.sellerEmail,
        sellerName: result.sellerName,
        buyerName: result.buyerName,
        listingTitle: result.listingTitle,
        orderCode: result.orderCode,
        amount: result.amount,
        reservationId,
      });
    }

    return toReservation(result.updated, 'BUYER', null, now);
  }

  // ------------------------------------------------------------------------------------------
  // PAY-3 · POST /reservations/:reservationId/payment/confirm (SELLER)
  // ------------------------------------------------------------------------------------------

  async confirmPayment(account: AuthAccount, reservationId: string): Promise<Reservation> {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM reservations WHERE id = ${reservationId}::uuid FOR UPDATE`;
      await this.expirePendingPaymentsInTx(tx, { reservationId }, now);

      const row = await tx.reservation.findUnique({
        where: { id: reservationId },
        include: {
          payment: true,
          listing: { select: { title: true, pickupEnd: true } },
          buyer: { select: { email: true, displayName: true } },
          seller: { select: { sellerName: true, displayName: true } },
        },
      });
      if (!row || row.sellerId !== account.id) throw new AppException('RESERVATION_NOT_FOUND');
      if (!row.payment) throw new AppException('PAYMENT_NOT_FOUND');
      if (row.status !== 'PENDING_PAYMENT' && row.status !== 'AWAITING_SELLER_CONFIRM') {
        throw new AppException('PAYMENT_NOT_CONFIRMABLE');
      }

      await tx.payment.update({
        where: { id: row.payment.id },
        data: {
          status: 'CONFIRMED',
          confirmedAt: now,
          paidAt: now,
        },
      });

      // Issue first pickup token for the buyer.
      await tx.pickupToken.updateMany({
        where: { reservationId, usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      const generated = generatePickupToken();
      const tokenExpiresAt = computePickupTokenExpiry(
        now,
        row.listing.pickupEnd!,
        this.config.reservations.pickupTokenTtlMin,
        this.config.reservations.noShowGraceMin,
      );
      await tx.pickupToken.create({
        data: {
          reservationId,
          tokenHash: generated.hash,
          expiresAt: tokenExpiresAt,
        },
      });

      const updated = await tx.reservation.update({
        where: { id: reservationId },
        data: { status: 'RESERVED' },
        include: RESERVATION_INCLUDE,
      });

      await logEvent(tx, {
        actorId: account.id,
        actorType: 'USER',
        event: 'PAYMENT_CONFIRMED',
        entityType: 'payment',
        entityId: row.payment.id,
        data: { reservationId, amount: row.payment.amount },
      });
      await logEvent(tx, {
        actorId: account.id,
        actorType: 'USER',
        event: 'RESERVATION_PAID',
        entityType: 'reservation',
        entityId: reservationId,
        data: { paymentId: row.payment.id, amount: row.payment.amount },
      });

      return {
        updated,
        buyerEmail: row.buyer.email,
        buyerName: row.buyer.displayName ?? 'Người mua',
        sellerName: row.seller.sellerName ?? row.seller.displayName ?? 'Người bán',
        listingTitle: row.listing.title,
        orderCode: formatOrderCode(row.code),
        amount: row.payment.amount,
      };
    });

    if (result.buyerEmail) {
      await this.mailer.sendPaymentConfirmedToBuyer({
        toEmail: result.buyerEmail,
        buyerName: result.buyerName,
        sellerName: result.sellerName,
        listingTitle: result.listingTitle,
        orderCode: result.orderCode,
        amount: result.amount,
        reservationId,
      });
    }

    return toReservation(result.updated, 'SELLER', null, now);
  }

  // ------------------------------------------------------------------------------------------
  // PAY-4 · POST /reservations/:reservationId/payment/reject (SELLER)
  // ------------------------------------------------------------------------------------------

  async rejectPayment(
    account: AuthAccount,
    reservationId: string,
    dto: RejectPaymentDto,
  ): Promise<Reservation> {
    const reason = dto.reason.trim();
    if (reason.length < 3 || reason.length > 300) {
      throw new AppException('VALIDATION_FAILED', {
        fields: { reason: 'must be between 3 and 300 characters' },
      });
    }

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM reservations WHERE id = ${reservationId}::uuid FOR UPDATE`;
      await this.expirePendingPaymentsInTx(tx, { reservationId }, now);

      const row = await tx.reservation.findUnique({
        where: { id: reservationId },
        include: {
          payment: true,
          listing: { select: { id: true, title: true } },
          buyer: { select: { email: true, displayName: true } },
          seller: { select: { sellerName: true, displayName: true } },
        },
      });
      if (!row || row.sellerId !== account.id) throw new AppException('RESERVATION_NOT_FOUND');
      if (!row.payment) throw new AppException('PAYMENT_NOT_FOUND');
      if (row.status !== 'PENDING_PAYMENT' && row.status !== 'AWAITING_SELLER_CONFIRM') {
        throw new AppException('PAYMENT_NOT_CONFIRMABLE');
      }

      await tx.payment.update({
        where: { id: row.payment.id },
        data: {
          status: 'REJECTED',
          rejectedAt: now,
          rejectReason: reason,
        },
      });

      const updated = await tx.reservation.update({
        where: { id: reservationId },
        data: {
          status: 'CANCELLED',
          cancelReason: 'PAYMENT_REJECTED',
          cancelNote: reason.slice(0, 200),
          closedAt: now,
        },
        include: RESERVATION_INCLUDE,
      });

      // Release stock atomically if listing is still PUBLISHED and before pickup_end.
      await tx.$executeRaw`
        UPDATE food_listings
           SET quantity_available = quantity_available + ${row.quantity}::int,
               updated_at = ${now}
         WHERE id = ${row.listingId}::uuid
           AND status = 'PUBLISHED'
           AND pickup_end > ${now}`;

      await logEvent(tx, {
        actorId: account.id,
        actorType: 'USER',
        event: 'PAYMENT_REJECTED',
        entityType: 'payment',
        entityId: row.payment.id,
        data: { reservationId, reason },
      });
      await logEvent(tx, {
        actorId: account.id,
        actorType: 'USER',
        event: 'RESERVATION_CANCELLED',
        entityType: 'reservation',
        entityId: reservationId,
        data: {
          reason: 'PAYMENT_REJECTED',
          note: reason,
          listingId: row.listingId,
          sellerId: row.sellerId,
          quantity: row.quantity,
        },
      });

      return {
        updated,
        buyerEmail: row.buyer.email,
        buyerName: row.buyer.displayName ?? 'Người mua',
        sellerName: row.seller.sellerName ?? row.seller.displayName ?? 'Người bán',
        listingTitle: row.listing.title,
        orderCode: formatOrderCode(row.code),
        amount: row.payment.amount,
      };
    });

    if (result.buyerEmail) {
      await this.mailer.sendPaymentRejectedToBuyer({
        toEmail: result.buyerEmail,
        buyerName: result.buyerName,
        sellerName: result.sellerName,
        listingTitle: result.listingTitle,
        orderCode: result.orderCode,
        amount: result.amount,
        reason,
        reservationId,
      });
    }

    return toReservation(result.updated, 'SELLER', null, now);
  }
}
