import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  RESERVATION_STATUSES,
  type PageInfo,
  type PickupBlockingReason,
  type PickupConfirmResponse,
  type PickupLookupResponse,
  type PickupToken,
  type Reservation,
  type ReservationStatus,
} from '@savemeal/shared';
import type { AuthAccount } from '../auth/auth.guard';
import { AppException } from '../common/errors/app-exception';
import { logEvent } from '../common/event-log';
import { decodeCursor, DEFAULT_LIMIT, paginate } from '../common/pagination';
import { RateLimiter } from '../common/rate-limiter';
import { localDate, toApiTime } from '../common/time';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import {
  computePickupTokenExpiry,
  generateOrderCode,
  generatePickupToken,
  hashPickupToken,
  parseManualCode,
  parseQrPayload,
} from './pickup-token';
import type {
  CancelReservationDto,
  CreateReservationDto,
  MyReservationsQueryDto,
  MySalesQueryDto,
  PickupConfirmDto,
  PickupLookupDto,
} from './reservation.dto';
import { RESERVATION_INCLUDE, toReservation, type ReservationRow, type ReservationViewerRole } from './reservation.mapper';

type Tx = Prisma.TransactionClient;

const IDEMPOTENCY_TTL_MS = 24 * 3600_000;
const PICKUP_TOKEN_PER_MIN = 6;
const PICKUP_SELLER_PER_MIN = 10;
const PICKUP_MANUAL_CODE_PER_MIN = 5;
const ONE_MINUTE_MS = 60_000;

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly rateLimiter: RateLimiter,
  ) {}

  // ------------------------------------------------------------------------------------------
  // RES-1: POST /reservations
  // ------------------------------------------------------------------------------------------

  async create(account: AuthAccount, dto: CreateReservationDto, rawIdempotencyKey: string | undefined): Promise<Reservation> {
    const idempotencyKey = rawIdempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length > 64) {
      throw new AppException('VALIDATION_FAILED', { fields: { 'Idempotency-Key': 'is required (1-64 characters)' } });
    }

    const now = new Date();
    // Retry only on the rare 1-in-10,000 collision on the seller's active 4-digit order code.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = await this.prisma.$transaction((tx) => this.createInTx(tx, account, dto, idempotencyKey, now));
        return toReservation(result.row, 'BUYER', result.pickupToken, now);
      } catch (error) {
        if (this.isCodeCollision(error) && attempt < 4) continue;
        throw error;
      }
    }
    throw new AppException('INTERNAL');
  }

  private async createInTx(
    tx: Tx,
    account: AuthAccount,
    dto: CreateReservationDto,
    idempotencyKey: string,
    now: Date,
  ): Promise<{ row: ReservationRow; pickupToken: PickupToken | null }> {
    // Serialises concurrent reservation attempts by the same buyer so limits and idempotency cannot race.
    await tx.$executeRaw`SELECT 1 FROM accounts WHERE id = ${account.id}::uuid FOR UPDATE`;

    const existingByKey = await tx.reservation.findUnique({
      where: { buyerId_idempotencyKey: { buyerId: account.id, idempotencyKey } },
      include: RESERVATION_INCLUDE,
    });
    if (existingByKey) {
      const sameBody = existingByKey.listingId === dto.listingId && existingByKey.quantity === dto.quantity;
      const withinWindow = now.getTime() - existingByKey.createdAt.getTime() <= IDEMPOTENCY_TTL_MS;
      if (sameBody && withinWindow) return { row: existingByKey, pickupToken: null };
      throw new AppException('IDEMPOTENCY_KEY_REUSED');
    }

    if (dto.quantity > this.config.reservations.maxQtyPerReservation) {
      throw new AppException('QUANTITY_LIMIT_EXCEEDED', { max: this.config.reservations.maxQtyPerReservation });
    }

    const existingActive = await tx.reservation.findFirst({
      where: { buyerId: account.id, listingId: dto.listingId, status: 'RESERVED' },
      select: { id: true },
    });
    if (existingActive) {
      throw new AppException('ALREADY_RESERVED', { reservationId: existingActive.id });
    }

    const activeCount = await tx.reservation.count({
      where: { buyerId: account.id, status: 'RESERVED' },
    });
    if (activeCount >= this.config.reservations.maxActivePerAccount) {
      throw new AppException('ACTIVE_RESERVATION_LIMIT', { limit: this.config.reservations.maxActivePerAccount });
    }

    // D§6: single conditional atomic UPDATE (no read-then-write).
    const updatedRows = await tx.$queryRaw<
      { id: string; seller_id: string; price: number; pickup_end: Date; quantity_available: number }[]
    >`
      UPDATE food_listings
         SET quantity_available = quantity_available - ${dto.quantity}::int,
             updated_at = ${now}
       WHERE id = ${dto.listingId}::uuid
         AND status = 'PUBLISHED'
         AND under_review = false
         AND quantity_available >= ${dto.quantity}::int
         AND pickup_end > ${now}
         AND seller_id <> ${account.id}::uuid
         AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = food_listings.seller_id AND a.status = 'ACTIVE')
      RETURNING id, seller_id, price, pickup_end, quantity_available`;

    if (updatedRows.length !== 1) {
      await this.diagnoseReservationFailure(tx, account.id, dto.listingId, now);
    }

    const listing = updatedRows[0]!;
    const code = await this.pickUniqueOrderCode(tx, listing.seller_id);
    const unitPrice = listing.price;
    const totalPrice = unitPrice * dto.quantity;

    const created = await tx.reservation.create({
      data: {
        listingId: dto.listingId,
        buyerId: account.id,
        sellerId: listing.seller_id,
        quantity: dto.quantity,
        unitPrice,
        totalPrice,
        code,
        status: 'RESERVED',
        idempotencyKey,
      },
      include: RESERVATION_INCLUDE,
    });

    const generated = generatePickupToken();
    const expiresAt = computePickupTokenExpiry(
      now,
      listing.pickup_end,
      this.config.reservations.pickupTokenTtlMin,
      this.config.reservations.noShowGraceMin,
    );
    await tx.pickupToken.create({
      data: {
        reservationId: created.id,
        tokenHash: generated.hash,
        expiresAt,
      },
    });

    await logEvent(tx, {
      actorId: account.id,
      actorType: 'USER',
      event: 'RESERVATION_CREATED',
      entityType: 'reservation',
      entityId: created.id,
      data: {
        listingId: dto.listingId,
        sellerId: listing.seller_id,
        quantity: dto.quantity,
        unitPrice,
        totalPrice,
      },
    });

    return {
      row: created,
      pickupToken: { qrPayload: generated.qrPayload, expiresAt: toApiTime(expiresAt) },
    };
  }

  private async diagnoseReservationFailure(tx: Tx, buyerId: string, listingId: string, now: Date): Promise<never> {
    const listing = await tx.foodListing.findUnique({
      where: { id: listingId },
      select: {
        sellerId: true,
        status: true,
        underReview: true,
        pickupEnd: true,
        quantityAvailable: true,
        seller: { select: { status: true } },
      },
    });
    if (!listing) throw new AppException('LISTING_NOT_FOUND');
    if (listing.sellerId === buyerId) throw new AppException('OWN_LISTING_RESERVATION');
    if (
      listing.status !== 'PUBLISHED' ||
      listing.underReview ||
      listing.seller.status !== 'ACTIVE' ||
      !listing.pickupEnd ||
      listing.pickupEnd.getTime() <= now.getTime()
    ) {
      throw new AppException('LISTING_NOT_AVAILABLE');
    }
    throw new AppException('LISTING_SOLD_OUT', { quantityAvailable: listing.quantityAvailable });
  }

  private async pickUniqueOrderCode(tx: Tx, sellerId: string): Promise<string> {
    const activeCodes = await tx.reservation.findMany({
      where: { sellerId, status: 'RESERVED' },
      select: { code: true },
    });
    const used = new Set(activeCodes.map((r) => r.code));
    for (let i = 0; i < 30; i++) {
      const candidate = generateOrderCode();
      if (!used.has(candidate)) return candidate;
    }
    return generateOrderCode();
  }

  private isCodeCollision(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
    const target = JSON.stringify(error.meta ?? '');
    return target.includes('reservations_code_unique_active_per_seller') || target.includes('code');
  }

  // ------------------------------------------------------------------------------------------
  // RES-2: GET /me/reservations
  // ------------------------------------------------------------------------------------------

  async myReservations(account: AuthAccount, query: MyReservationsQueryDto): Promise<{ data: Reservation[]; page: PageInfo }> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = decodeCursor(query.cursor);
    const isHistory = query.tab === 'history';
    const statuses: ReservationStatus[] = isHistory ? ['COMPLETED', 'CANCELLED', 'EXPIRED'] : ['RESERVED'];

    const rows = await this.prisma.reservation.findMany({
      where: { buyerId: account.id, status: { in: statuses } },
      include: RESERVATION_INCLUDE,
      orderBy: isHistory
        ? [{ createdAt: 'desc' }, { id: 'asc' }]
        : [{ listing: { pickupStart: 'asc' } }, { createdAt: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
    });
    const { items, page } = paginate(rows, offset, limit);
    const now = new Date();
    return {
      data: items.map((row) => toReservation(row, 'BUYER', null, now)),
      page,
    };
  }

  // ------------------------------------------------------------------------------------------
  // RES-3: GET /reservations/:reservationId
  // ------------------------------------------------------------------------------------------

  async getById(account: AuthAccount, id: string): Promise<Reservation> {
    const row = await this.prisma.reservation.findUnique({ where: { id }, include: RESERVATION_INCLUDE });
    if (!row) throw new AppException('RESERVATION_NOT_FOUND');

    let viewerRole: ReservationViewerRole;
    if (account.id === row.buyerId) viewerRole = 'BUYER';
    else if (account.id === row.sellerId) viewerRole = 'SELLER';
    else if (account.role === 'ADMIN') viewerRole = 'ADMIN';
    else throw new AppException('RESERVATION_NOT_FOUND');

    return toReservation(row, viewerRole, null, new Date());
  }

  // ------------------------------------------------------------------------------------------
  // RES-4: POST /reservations/:reservationId/cancel
  // ------------------------------------------------------------------------------------------

  async cancel(account: AuthAccount, id: string, dto: CancelReservationDto): Promise<Reservation> {
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM reservations WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.reservation.findUnique({
        where: { id },
        include: { listing: { select: { id: true, status: true, pickupEnd: true } } },
      });
      if (!row || row.buyerId !== account.id) throw new AppException('RESERVATION_NOT_FOUND');
      if (row.status !== 'RESERVED') throw new AppException('RESERVATION_NOT_ACTIVE');
      if (!row.listing.pickupEnd || now.getTime() >= row.listing.pickupEnd.getTime()) {
        throw new AppException('CANCEL_WINDOW_CLOSED');
      }

      const cancelled = await tx.reservation.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelReason: dto.reason,
          cancelNote: dto.note ?? null,
          closedAt: now,
        },
        include: RESERVATION_INCLUDE,
      });

      await tx.pickupToken.updateMany({
        where: { reservationId: id, usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });

      // D§4: release stock atomically if the listing is still PUBLISHED and before pickup_end.
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
        event: 'RESERVATION_CANCELLED',
        entityType: 'reservation',
        entityId: id,
        data: {
          reason: dto.reason,
          note: dto.note ?? null,
          listingId: row.listingId,
          sellerId: row.sellerId,
          quantity: row.quantity,
        },
      });

      return cancelled;
    });
    return toReservation(updated, 'BUYER', null, now);
  }

  // ------------------------------------------------------------------------------------------
  // RES-5: GET /me/sales
  // ------------------------------------------------------------------------------------------

  async mySales(account: AuthAccount, query: MySalesQueryDto): Promise<{ data: Reservation[]; page: PageInfo }> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = decodeCursor(query.cursor);
    const now = new Date();

    const statuses = this.parseStatuses(query.status);
    const dateStr = query.date ?? localDate(now);
    const dayStart = new Date(`${dateStr}T00:00:00+07:00`);
    if (Number.isNaN(dayStart.getTime())) {
      throw new AppException('VALIDATION_FAILED', { fields: { date: 'must be a valid YYYY-MM-DD date' } });
    }
    const nextDayStart = new Date(dayStart.getTime() + 86_400_000);

    const rows = await this.prisma.reservation.findMany({
      where: {
        sellerId: account.id,
        status: { in: statuses },
        ...(query.listingId ? { listingId: query.listingId } : {}),
        listing: {
          pickupStart: { gte: dayStart, lt: nextDayStart },
        },
      },
      include: RESERVATION_INCLUDE,
      orderBy: [{ listing: { pickupStart: 'asc' } }, { createdAt: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
    });
    const { items, page } = paginate(rows, offset, limit);
    return {
      data: items.map((row) => toReservation(row, 'SELLER', null, now)),
      page,
    };
  }

  private parseStatuses(raw: string | undefined): ReservationStatus[] {
    if (!raw || raw.trim() === '') return ['RESERVED'];
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 0) return ['RESERVED'];
    const invalid = parts.filter((s) => !(RESERVATION_STATUSES as readonly string[]).includes(s));
    if (invalid.length > 0) {
      throw new AppException('VALIDATION_FAILED', { fields: { status: `unknown status: ${invalid.join(', ')}` } });
    }
    return parts as ReservationStatus[];
  }

  // ------------------------------------------------------------------------------------------
  // RES-6: POST /reservations/:reservationId/pickup-token
  // ------------------------------------------------------------------------------------------

  async rotatePickupToken(account: AuthAccount, id: string): Promise<PickupToken> {
    this.rateLimiter.consume(`pickup-token:${account.id}:${id}`, PICKUP_TOKEN_PER_MIN, ONE_MINUTE_MS);

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM reservations WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.reservation.findUnique({
        where: { id },
        include: { listing: { select: { pickupEnd: true } } },
      });
      if (!row || row.buyerId !== account.id) throw new AppException('RESERVATION_NOT_FOUND');
      if (row.status !== 'RESERVED') throw new AppException('RESERVATION_NOT_ACTIVE');

      const windowCloseMs = row.listing.pickupEnd!.getTime() + this.config.reservations.noShowGraceMin * ONE_MINUTE_MS;
      if (now.getTime() >= windowCloseMs) throw new AppException('PICKUP_WINDOW_CLOSED');

      await tx.pickupToken.updateMany({
        where: { reservationId: id, usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });

      const generated = generatePickupToken();
      const expiresAt = computePickupTokenExpiry(
        now,
        row.listing.pickupEnd!,
        this.config.reservations.pickupTokenTtlMin,
        this.config.reservations.noShowGraceMin,
      );
      await tx.pickupToken.create({
        data: {
          reservationId: id,
          tokenHash: generated.hash,
          expiresAt,
        },
      });
      return { qrPayload: generated.qrPayload, expiresAt: toApiTime(expiresAt) };
    });
  }

  // ------------------------------------------------------------------------------------------
  // RES-7: POST /pickups/lookup
  // ------------------------------------------------------------------------------------------

  async lookupPickup(account: AuthAccount, dto: PickupLookupDto): Promise<PickupLookupResponse> {
    const hasQr = dto.qrPayload !== undefined && dto.qrPayload.trim() !== '';
    const hasCode = dto.code !== undefined && dto.code.trim() !== '';
    if (hasQr === hasCode) {
      throw new AppException('VALIDATION_FAILED', {
        fields: { qrPayload: 'provide exactly one of qrPayload or code' },
      });
    }

    this.consumePickupRateLimit(account.id, hasCode);

    const now = new Date();
    if (hasQr) {
      const raw = parseQrPayload(dto.qrPayload!);
      if (!raw) throw new AppException('PICKUP_TOKEN_INVALID');

      const token = await this.prisma.pickupToken.findUnique({
        where: { tokenHash: hashPickupToken(raw) },
        include: { reservation: { include: RESERVATION_INCLUDE } },
      });
      if (!token || token.reservation.sellerId !== account.id) {
        throw new AppException('PICKUP_TOKEN_INVALID');
      }

      const blockingReason = this.evaluateBlockingReason(token.reservation, token, now);
      return {
        reservation: toReservation(token.reservation, 'SELLER', null, now),
        amountToCollect: token.reservation.totalPrice,
        canConfirm: blockingReason === null,
        blockingReason,
      };
    }

    const code = parseManualCode(dto.code!);
    if (!code) throw new AppException('PICKUP_CODE_INVALID');

    const reservation = await this.prisma.reservation.findFirst({
      where: { sellerId: account.id, code, status: 'RESERVED' },
      include: RESERVATION_INCLUDE,
    });
    if (!reservation) throw new AppException('PICKUP_CODE_INVALID');

    const blockingReason = this.evaluateBlockingReason(reservation, null, now);
    return {
      reservation: toReservation(reservation, 'SELLER', null, now),
      amountToCollect: reservation.totalPrice,
      canConfirm: blockingReason === null,
      blockingReason,
    };
  }

  // ------------------------------------------------------------------------------------------
  // RES-8: POST /pickups/confirm
  // ------------------------------------------------------------------------------------------

  async confirmPickup(account: AuthAccount, dto: PickupConfirmDto): Promise<PickupConfirmResponse> {
    const hasQr = dto.qrPayload !== undefined && dto.qrPayload.trim() !== '';
    const hasCode = dto.code !== undefined && dto.code.trim() !== '';
    if (hasQr === hasCode) {
      throw new AppException('VALIDATION_FAILED', {
        fields: { qrPayload: 'provide exactly one of qrPayload or code' },
      });
    }

    this.consumePickupRateLimit(account.id, hasCode);

    const rawToken = hasQr ? parseQrPayload(dto.qrPayload!) : null;
    if (hasQr && !rawToken) throw new AppException('PICKUP_TOKEN_INVALID');

    const manualCode = hasCode ? parseManualCode(dto.code!) : null;
    if (hasCode && !manualCode) throw new AppException('PICKUP_CODE_INVALID');

    const now = new Date();
    const { updated, listingRemaining } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM reservations WHERE id = ${dto.reservationId}::uuid FOR UPDATE`;
      const row = await tx.reservation.findUnique({
        where: { id: dto.reservationId },
        include: RESERVATION_INCLUDE,
      });
      if (!row || row.sellerId !== account.id) throw new AppException('RESERVATION_NOT_FOUND');

      if (row.listing.status === 'BLOCKED') throw new AppException('LISTING_BLOCKED');

      let matchedTokenId: string | null = null;
      if (rawToken) {
        const token = await tx.pickupToken.findUnique({
          where: { tokenHash: hashPickupToken(rawToken) },
        });
        if (!token || token.reservationId !== row.id) throw new AppException('PICKUP_TOKEN_INVALID');
        if (token.usedAt !== null) throw new AppException('PICKUP_TOKEN_USED');
        if (row.status !== 'RESERVED') throw new AppException('RESERVATION_NOT_ACTIVE');
        if (token.revokedAt !== null || now.getTime() >= token.expiresAt.getTime()) {
          throw new AppException('PICKUP_TOKEN_EXPIRED');
        }
        matchedTokenId = token.id;
      } else {
        if (row.status !== 'RESERVED') throw new AppException('RESERVATION_NOT_ACTIVE');
        if (row.code !== manualCode) throw new AppException('PICKUP_CODE_INVALID');
      }

      const earliest = row.listing.pickupStart!.getTime() - this.config.reservations.earlyPickupMin * ONE_MINUTE_MS;
      const latest = row.listing.pickupEnd!.getTime() + this.config.reservations.noShowGraceMin * ONE_MINUTE_MS;
      if (now.getTime() < earliest) throw new AppException('PICKUP_TOO_EARLY');
      if (now.getTime() > latest) throw new AppException('PICKUP_WINDOW_CLOSED');

      if (matchedTokenId) {
        const used = await tx.pickupToken.updateMany({
          where: { id: matchedTokenId, usedAt: null, revokedAt: null },
          data: { usedAt: now },
        });
        if (used.count !== 1) throw new AppException('PICKUP_TOKEN_USED');
      }
      await tx.pickupToken.updateMany({
        where: { reservationId: row.id, usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });

      const completed = await tx.reservation.update({
        where: { id: row.id },
        data: { status: 'COMPLETED', completedAt: now, closedAt: now },
        include: RESERVATION_INCLUDE,
      });

      const originalPrice = row.listing.originalPrice;
      const discountRate =
        originalPrice !== null && originalPrice > 0 ? (originalPrice - row.unitPrice) / originalPrice : null;

      await logEvent(tx, {
        actorId: account.id,
        actorType: 'USER',
        event: 'RESERVATION_COMPLETED',
        entityType: 'reservation',
        entityId: row.id,
        data: {
          listingId: row.listingId,
          sellerId: row.sellerId,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
          originalPrice,
          discountRate,
          method: rawToken ? 'QR' : 'CODE',
        },
      });

      return { updated: completed, listingRemaining: completed.listing.quantityAvailable };
    });

    return {
      reservation: toReservation(updated, 'SELLER', null, now),
      listingRemaining,
    };
  }

  private consumePickupRateLimit(sellerId: string, isManualCode: boolean): void {
    if (isManualCode) {
      this.rateLimiter.consume(`pickup-code:${sellerId}`, PICKUP_MANUAL_CODE_PER_MIN, ONE_MINUTE_MS);
    }
    this.rateLimiter.consume(`pickup-seller:${sellerId}`, PICKUP_SELLER_PER_MIN, ONE_MINUTE_MS);
  }

  private evaluateBlockingReason(
    row: ReservationRow,
    token: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date } | null,
    now: Date,
  ): PickupBlockingReason | null {
    if (row.listing.status === 'BLOCKED') return 'LISTING_BLOCKED';
    if (token && token.usedAt !== null) return 'TOKEN_USED';
    if (row.status !== 'RESERVED') return 'NOT_ACTIVE';
    if (token && (token.revokedAt !== null || now.getTime() >= token.expiresAt.getTime())) return 'TOKEN_EXPIRED';

    const earliest = row.listing.pickupStart!.getTime() - this.config.reservations.earlyPickupMin * ONE_MINUTE_MS;
    const latest = row.listing.pickupEnd!.getTime() + this.config.reservations.noShowGraceMin * ONE_MINUTE_MS;
    if (now.getTime() < earliest) return 'TOO_EARLY';
    if (now.getTime() > latest) return 'WINDOW_CLOSED';
    return null;
  }
}
