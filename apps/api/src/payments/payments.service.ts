import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  formatOrderCode,
  type AdminSettlePayoutResponse,
  type MyPayoutsResponse,
  type PageInfo,
  type Payment,
  type PayoutAccount,
  type PayoutItem,
  type Reservation,
} from '@savemeal/shared';
import { randomUUID } from 'node:crypto';
import type { AuthAccount } from '../auth/auth.guard';
import { AppException } from '../common/errors/app-exception';
import { logEvent } from '../common/event-log';
import { decodeCursor, DEFAULT_LIMIT, paginate } from '../common/pagination';
import { toApiTime, toApiTimeOrNull } from '../common/time';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { computePickupTokenExpiry, generatePickupToken } from '../reservations/pickup-token';
import { RESERVATION_INCLUDE, toReservation } from '../reservations/reservation.mapper';
import type {
  AdminMarkRefundedDto,
  AdminPaymentsQueryDto,
  AdminSettlePayoutDto,
  MyPayoutsQueryDto,
  SePayWebhookDto,
  UpdatePayoutAccountDto,
} from './payment.dto';
import { extractTransferContent, verifySePayApiKey } from './payment.gateway';
import { toPayment } from './payment.mapper';

type Tx = Prisma.TransactionClient;

export type ExpirePendingFilter = {
  listingId?: string;
  buyerId?: string;
  reservationId?: string;
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------------------------------------
  // Lazy-expiry & JOB-2 helper
  // ------------------------------------------------------------------------------------------

  /**
   * Atomically expires `PENDING_PAYMENT` reservations whose `payment_expires_at <= now`,
   * marks their `UNPAID` payments `EXPIRED`, releases stock back to `PUBLISHED` listings still
   * before `pickup_end`, and appends `RESERVATION_EXPIRED` + `PAYMENT_EXPIRED` event logs.
   */
  async expirePendingPayments(tx?: Tx, filter?: ExpirePendingFilter, now = new Date()): Promise<number> {
    if (tx) return this.expirePendingPaymentsInTx(tx, filter, now);
    return this.prisma.$transaction((innerTx) => this.expirePendingPaymentsInTx(innerTx, filter, now));
  }

  private async expirePendingPaymentsInTx(tx: Tx, filter: ExpirePendingFilter | undefined, now: Date): Promise<number> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`status = 'PENDING_PAYMENT'`,
      Prisma.sql`payment_expires_at <= ${now}`,
    ];
    if (filter?.listingId) conditions.push(Prisma.sql`listing_id = ${filter.listingId}::uuid`);
    if (filter?.buyerId) conditions.push(Prisma.sql`buyer_id = ${filter.buyerId}::uuid`);
    if (filter?.reservationId) conditions.push(Prisma.sql`id = ${filter.reservationId}::uuid`);

    const expired = await tx.$queryRaw<
      { id: string; listing_id: string; seller_id: string; quantity: number }[]
    >`
      UPDATE reservations
         SET status = 'EXPIRED', closed_at = ${now}, updated_at = ${now}
       WHERE ${Prisma.join(conditions, ' AND ')}
      RETURNING id, listing_id, seller_id, quantity`;

    if (expired.length === 0) return 0;

    const idParams = expired.map((r) => Prisma.sql`${r.id}::uuid`);
    const expiredPayments = await tx.$queryRaw<{ id: string; reservation_id: string }[]>`
      UPDATE payments
         SET status = 'EXPIRED', updated_at = ${now}
       WHERE reservation_id IN (${Prisma.join(idParams)})
         AND status = 'UNPAID'
      RETURNING id, reservation_id`;

    for (const row of expired) {
      await tx.$executeRaw`
        UPDATE food_listings
           SET quantity_available = quantity_available + ${row.quantity}::int,
               updated_at = ${now}
         WHERE id = ${row.listing_id}::uuid
           AND status = 'PUBLISHED'
           AND pickup_end > ${now}`;

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
          reason: 'PAYMENT_EXPIRED',
        },
      });
    }

    for (const payment of expiredPayments) {
      await logEvent(tx, {
        actorId: null,
        actorType: 'SYSTEM',
        event: 'PAYMENT_EXPIRED',
        entityType: 'payment',
        entityId: payment.id,
        data: { reservationId: payment.reservation_id },
      });
    }

    return expired.length;
  }

  // ------------------------------------------------------------------------------------------
  // PAY-1: GET /reservations/:reservationId/payment
  // ------------------------------------------------------------------------------------------

  async getForReservation(account: AuthAccount, reservationId: string): Promise<Payment> {
    await this.expirePendingPayments(undefined, { reservationId });

    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { payment: true },
    });
    if (!reservation || (account.id !== reservation.buyerId && account.role !== 'ADMIN')) {
      throw new AppException('RESERVATION_NOT_FOUND');
    }
    if (!reservation.payment) {
      throw new AppException('PAYMENT_NOT_FOUND');
    }
    return toPayment(reservation.payment);
  }

  // ------------------------------------------------------------------------------------------
  // PAY-2: POST /webhooks/sepay
  // ------------------------------------------------------------------------------------------

  verifyWebhookAuth(authHeader: string | undefined): void {
    const secret = this.config.payments.sepay.webhookSecret;
    if (!secret || !verifySePayApiKey(authHeader, secret)) {
      throw new AppException('UNAUTHENTICATED');
    }
  }

  async handleSePayWebhook(authHeader: string | undefined, body: SePayWebhookDto): Promise<{ received: true }> {
    this.verifyWebhookAuth(authHeader);

    if (body.transferType !== 'in') {
      return { received: true };
    }

    const transferContent =
      extractTransferContent(body.content ?? '') ?? extractTransferContent(body.description ?? '');
    if (!transferContent) {
      return { received: true };
    }

    const providerTxId = String(body.id);

    const existingByTx = await this.prisma.payment.findUnique({
      where: { providerTxId },
      select: { id: true },
    });
    if (existingByTx) {
      return { received: true };
    }

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; reservation_id: string }[]>`
        SELECT id, reservation_id
          FROM payments
         WHERE transfer_content = ${transferContent}
         FOR UPDATE`;
      if (locked.length === 0) return;

      // Re-check idempotency inside the lock in case of concurrent duplicate deliveries.
      const dup = await tx.payment.findUnique({
        where: { providerTxId },
        select: { id: true },
      });
      if (dup) return;

      const paymentRef = locked[0]!;
      await tx.$executeRaw`SELECT 1 FROM reservations WHERE id = ${paymentRef.reservation_id}::uuid FOR UPDATE`;

      const payment = await tx.payment.findUnique({
        where: { id: paymentRef.id },
        include: {
          reservation: {
            include: { listing: { select: { pickupEnd: true } } },
          },
        },
      });
      if (!payment) return;

      const now = new Date();
      const reservation = payment.reservation;
      const canSettle =
        payment.status === 'UNPAID' &&
        reservation.status === 'PENDING_PAYMENT' &&
        now.getTime() < payment.expiresAt.getTime() &&
        body.transferAmount >= payment.payableAmount;

      if (canSettle) {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'PAID',
            providerTxId,
            paidAt: now,
          },
        });

        await tx.reservation.update({
          where: { id: reservation.id },
          data: { status: 'RESERVED' },
        });

        const generated = generatePickupToken();
        const tokenExpiresAt = computePickupTokenExpiry(
          now,
          reservation.listing.pickupEnd!,
          this.config.reservations.pickupTokenTtlMin,
          this.config.reservations.noShowGraceMin,
        );
        await tx.pickupToken.create({
          data: {
            reservationId: reservation.id,
            tokenHash: generated.hash,
            expiresAt: tokenExpiresAt,
          },
        });

        await logEvent(tx, {
          actorId: null,
          actorType: 'SYSTEM',
          event: 'PAYMENT_PAID',
          entityType: 'payment',
          entityId: payment.id,
          data: {
            reservationId: reservation.id,
            providerTxId,
            transferAmount: body.transferAmount,
            payableAmount: payment.payableAmount,
          },
        });

        await logEvent(tx, {
          actorId: null,
          actorType: 'SYSTEM',
          event: 'RESERVATION_PAID',
          entityType: 'reservation',
          entityId: reservation.id,
          data: {
            paymentId: payment.id,
            providerTxId,
          },
        });
        return;
      }

      const refundNote = this.buildRefundNote(payment, reservation.status, body.transferAmount, providerTxId, now);
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'REFUND_DUE',
          providerTxId: payment.providerTxId ?? providerTxId,
          refundNote,
        },
      });

      await logEvent(tx, {
        actorId: null,
        actorType: 'SYSTEM',
        event: 'PAYMENT_REFUND_DUE',
        entityType: 'payment',
        entityId: payment.id,
        data: {
          reservationId: reservation.id,
          providerTxId,
          transferAmount: body.transferAmount,
          payableAmount: payment.payableAmount,
          reason: refundNote,
        },
      });
    });

    return { received: true };
  }

  private buildRefundNote(
    payment: { status: string; payableAmount: number; expiresAt: Date },
    reservationStatus: string,
    transferAmount: number,
    providerTxId: string,
    now: Date,
  ): string {
    if (transferAmount < payment.payableAmount) {
      return `Underpaid: received ${transferAmount}, expected ${payment.payableAmount} (tx ${providerTxId})`;
    }
    if (now.getTime() >= payment.expiresAt.getTime() || reservationStatus === 'EXPIRED') {
      return `Late payment after expiry (tx ${providerTxId}, amount ${transferAmount})`;
    }
    return `Unexpected payment in state payment=${payment.status}, reservation=${reservationStatus} (tx ${providerTxId}, amount ${transferAmount})`;
  }

  // ------------------------------------------------------------------------------------------
  // PAY-DEV: POST /reservations/:reservationId/payment/simulate
  // ------------------------------------------------------------------------------------------

  async simulatePayment(account: AuthAccount, reservationId: string): Promise<Reservation> {
    if (!this.config.features.payments || this.config.payments.provider !== 'mock') {
      throw new AppException('FEATURE_DISABLED');
    }

    const now = new Date();
    await this.expirePendingPayments(undefined, { reservationId }, now);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM reservations WHERE id = ${reservationId}::uuid FOR UPDATE`;

      const row = await tx.reservation.findUnique({
        where: { id: reservationId },
        include: RESERVATION_INCLUDE,
      });
      if (!row || row.buyerId !== account.id) {
        throw new AppException('RESERVATION_NOT_FOUND');
      }
      if (!row.payment) {
        throw new AppException('PAYMENT_NOT_FOUND');
      }
      if (row.status !== 'PENDING_PAYMENT') {
        throw new AppException('INVALID_STATE_TRANSITION', { from: row.status, action: 'simulate_payment' });
      }

      const providerTxId = `MOCK-${randomUUID()}`;
      await tx.payment.update({
        where: { id: row.payment.id },
        data: {
          status: 'PAID',
          providerTxId,
          paidAt: now,
        },
      });

      const updated = await tx.reservation.update({
        where: { id: row.id },
        data: { status: 'RESERVED' },
        include: RESERVATION_INCLUDE,
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
          reservationId: row.id,
          tokenHash: generated.hash,
          expiresAt: tokenExpiresAt,
        },
      });

      await logEvent(tx, {
        actorId: account.id,
        actorType: 'USER',
        event: 'PAYMENT_PAID',
        entityType: 'payment',
        entityId: row.payment.id,
        data: {
          reservationId: row.id,
          providerTxId,
          simulated: true,
        },
      });

      await logEvent(tx, {
        actorId: account.id,
        actorType: 'USER',
        event: 'RESERVATION_PAID',
        entityType: 'reservation',
        entityId: row.id,
        data: {
          paymentId: row.payment.id,
          providerTxId,
          simulated: true,
        },
      });

      return toReservation(
        updated,
        'BUYER',
        { qrPayload: generated.qrPayload, expiresAt: toApiTime(tokenExpiresAt) },
        now,
      );
    });
  }

  // ------------------------------------------------------------------------------------------
  // PAY-3: GET /me/payouts
  // ------------------------------------------------------------------------------------------

  async myPayouts(
    account: AuthAccount,
    query: MyPayoutsQueryDto,
  ): Promise<{ data: MyPayoutsResponse; page: PageInfo }> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = decodeCursor(query.cursor);

    const aggregates = await this.prisma.payment.groupBy({
      by: ['payoutStatus'],
      where: {
        sellerId: account.id,
        status: 'PAID',
        payoutStatus: { in: ['PENDING_PAYOUT', 'SETTLED'] },
      },
      _sum: { sellerNet: true },
    });

    let pendingPayoutVnd = 0;
    let settledVnd = 0;
    for (const row of aggregates) {
      if (row.payoutStatus === 'PENDING_PAYOUT') pendingPayoutVnd = row._sum.sellerNet ?? 0;
      else if (row.payoutStatus === 'SETTLED') settledVnd = row._sum.sellerNet ?? 0;
    }

    const rows = await this.prisma.payment.findMany({
      where: {
        sellerId: account.id,
        status: 'PAID',
        payoutStatus: query.payoutStatus ? query.payoutStatus : { in: ['PENDING_PAYOUT', 'SETTLED'] },
      },
      include: {
        reservation: {
          select: {
            id: true,
            code: true,
            completedAt: true,
            listing: { select: { title: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
    });

    const { items: rawItems, page } = paginate(rows, offset, limit);
    const items: PayoutItem[] = rawItems.map((row) => ({
      paymentId: row.id,
      reservationId: row.reservationId,
      reservationCode: formatOrderCode(row.reservation.code),
      listingTitle: row.reservation.listing.title,
      foodAmount: row.foodAmount,
      sellerNet: row.sellerNet,
      payoutStatus: row.payoutStatus,
      completedAt: toApiTimeOrNull(row.reservation.completedAt),
      settledAt: toApiTimeOrNull(row.settledAt),
    }));

    return {
      data: {
        summary: {
          pendingPayoutVnd,
          settledVnd,
          totalFoodRevenueVnd: pendingPayoutVnd + settledVnd,
        },
        items,
      },
      page,
    };
  }

  // ------------------------------------------------------------------------------------------
  // PAY-4: PUT /me/payout-account
  // ------------------------------------------------------------------------------------------

  async upsertPayoutAccount(account: AuthAccount, dto: UpdatePayoutAccountDto): Promise<PayoutAccount> {
    const bankCode = dto.bankCode.trim().toUpperCase();
    const accountNo = dto.accountNo.trim();
    const accountName = dto.accountName.trim();

    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.sellerPayoutAccount.upsert({
        where: { accountId: account.id },
        create: { accountId: account.id, bankCode, accountNo, accountName },
        update: { bankCode, accountNo, accountName },
      });

      await logEvent(tx, {
        actorId: account.id,
        actorType: 'USER',
        event: 'PAYOUT_ACCOUNT_UPDATED',
        entityType: 'account',
        entityId: account.id,
        data: { bankCode },
      });

      return saved;
    });

    return {
      bankCode: row.bankCode,
      accountNo: row.accountNo,
      accountName: row.accountName,
      updatedAt: toApiTime(row.updatedAt),
    };
  }

  // ------------------------------------------------------------------------------------------
  // PAY-5: Admin payment & payout management
  // ------------------------------------------------------------------------------------------

  async adminListPayments(query: AdminPaymentsQueryDto): Promise<{ data: Payment[]; page: PageInfo }> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = decodeCursor(query.cursor);

    const rows = await this.prisma.payment.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.payoutStatus ? { payoutStatus: query.payoutStatus } : {}),
        ...(query.sellerId ? { sellerId: query.sellerId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
    });

    const { items, page } = paginate(rows, offset, limit);
    return {
      data: items.map(toPayment),
      page,
    };
  }

  async adminMarkRefunded(admin: AuthAccount, paymentId: string, dto: AdminMarkRefundedDto): Promise<Payment> {
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;

      const row = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!row) throw new AppException('PAYMENT_NOT_FOUND');
      if (row.status !== 'REFUND_DUE') throw new AppException('PAYMENT_NOT_REFUNDABLE');

      const saved = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'REFUNDED',
          refundedAt: now,
          refundNote: dto.note.trim(),
        },
      });

      await logEvent(tx, {
        actorId: admin.id,
        actorType: 'ADMIN',
        event: 'PAYMENT_REFUNDED',
        entityType: 'payment',
        entityId: paymentId,
        data: {
          reservationId: row.reservationId,
          payableAmount: row.payableAmount,
          note: dto.note.trim(),
        },
      });

      return saved;
    });

    return toPayment(updated);
  }

  async adminSettlePayout(
    admin: AuthAccount,
    sellerId: string,
    dto: AdminSettlePayoutDto,
  ): Promise<AdminSettlePayoutResponse> {
    const seller = await this.prisma.account.findUnique({
      where: { id: sellerId },
      select: { id: true },
    });
    if (!seller) throw new AppException('ACCOUNT_NOT_FOUND');

    const now = new Date();
    const note = dto.note.trim();

    return this.prisma.$transaction(async (tx) => {
      const settled = await tx.$queryRaw<{ id: string; seller_net: number }[]>`
        UPDATE payments
           SET payout_status = 'SETTLED',
               settled_at = ${now},
               settle_note = ${note},
               updated_at = ${now}
         WHERE seller_id = ${sellerId}::uuid
           AND status = 'PAID'
           AND payout_status = 'PENDING_PAYOUT'
        RETURNING id, seller_net`;

      const settledCount = settled.length;
      const settledAmountVnd = settled.reduce((sum, r) => sum + r.seller_net, 0);

      await logEvent(tx, {
        actorId: admin.id,
        actorType: 'ADMIN',
        event: 'PAYOUT_SETTLED',
        entityType: 'account',
        entityId: sellerId,
        data: {
          settledCount,
          settledAmountVnd,
          note,
          paymentIds: settled.map((r) => r.id),
        },
      });

      return {
        sellerId,
        settledCount,
        settledAmountVnd,
        settledAt: toApiTime(now),
      };
    });
  }
}
