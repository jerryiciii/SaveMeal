import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { logEvent } from '../common/event-log';
import { localDate } from '../common/time';
import { AppConfig } from '../config/app-config';
import { MediaStorage } from '../media/media-storage';
import { PrismaService } from '../prisma/prisma.service';

export type CleanupResult = {
  otpRequests: number;
  refreshTokens: number;
  pickupTokens: number;
  images: number;
};

type MetricBucket = {
  date: Date;
  sellerId: string;
  listingsPublished: number;
  listingsExpiredWithStock: number;
  portionsListed: number;
  portionsReserved: number;
  portionsHandedOver: number;
  reservationsCreated: number;
  reservationsCompleted: number;
  reservationsCancelled: number;
  reservationsExpired: number;
  discountRateSum: number;
  discountSamples: number;
};

const METRIC_EVENTS = [
  'LISTING_PUBLISHED',
  'LISTING_EXPIRED',
  'RESERVATION_CREATED',
  'RESERVATION_COMPLETED',
  'RESERVATION_CANCELLED',
  'RESERVATION_EXPIRED',
] as const;

const DAY_MS = 86_400_000;

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly media: MediaStorage,
  ) {}

  private shouldSkipInProcessCron(): boolean {
    return this.config.nodeEnv === 'test' || Boolean(process.env.VERCEL);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpireListings(): Promise<void> {
    if (this.shouldSkipInProcessCron()) return;
    const count = await this.expireListings();
    if (count > 0) this.logger.log(`JOB-1 expired ${count} listing(s)`);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpireReservations(): Promise<void> {
    if (this.shouldSkipInProcessCron()) return;
    const count = await this.expireReservations();
    if (count > 0) this.logger.log(`JOB-2 expired ${count} reservation(s)`);
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCleanupExpiredData(): Promise<void> {
    if (this.shouldSkipInProcessCron()) return;
    const res = await this.cleanupExpiredData();
    this.logger.log(
      `JOB-3 cleaned otp=${res.otpRequests} refresh=${res.refreshTokens} pickup=${res.pickupTokens} images=${res.images}`,
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleRebuildMetrics(): Promise<void> {
    if (this.shouldSkipInProcessCron()) return;
    const count = await this.rebuildMetrics();
    this.logger.log(`JOB-4 rebuilt ${count} transaction_metrics row(s)`);
  }

  /**
   * JOB-1: idempotently marks PUBLISHED listings with pickupEnd <= now as EXPIRED and logs
   * LISTING_EXPIRED events.
   */
  async expireListings(now = new Date()): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const expired = await tx.$queryRaw<{ id: string; seller_id: string; quantity_available: number }[]>`
        UPDATE food_listings
           SET status = 'EXPIRED', closed_at = ${now}, updated_at = ${now}
         WHERE status = 'PUBLISHED' AND pickup_end <= ${now}
        RETURNING id, seller_id, quantity_available`;

      for (const row of expired) {
        await logEvent(tx, {
          actorId: null,
          actorType: 'SYSTEM',
          event: 'LISTING_EXPIRED',
          entityType: 'listing',
          entityId: row.id,
          data: {
            sellerId: row.seller_id,
            quantityAvailable: row.quantity_available,
            expiredWithStock: row.quantity_available > 0,
          },
        });
      }
      return expired.length;
    });
  }

  /**
   * JOB-2: idempotently marks RESERVED reservations whose listing pickupEnd + noShowGraceMin <= now
   * as EXPIRED, revokes their unused pickup tokens, and logs RESERVATION_EXPIRED events.
   */
  async expireReservations(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.reservations.noShowGraceMin * 60_000);
    return this.prisma.$transaction(async (tx) => {
      const expired = await tx.$queryRaw<
        { id: string; listing_id: string; seller_id: string; quantity: number }[]
      >`
        UPDATE reservations r
           SET status = 'EXPIRED', closed_at = ${now}, updated_at = ${now}
          FROM food_listings l
         WHERE r.listing_id = l.id
           AND r.status = 'RESERVED'
           AND l.pickup_end <= ${cutoff}
        RETURNING r.id, r.listing_id, r.seller_id, r.quantity`;

      if (expired.length === 0) return 0;

      const ids = expired.map((r) => r.id);
      await tx.pickupToken.updateMany({
        where: { reservationId: { in: ids }, usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });

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
          },
        });
      }
      return expired.length;
    });
  }

  /**
   * JOB-3: purges expired OTPs, refresh tokens, and pickup tokens older than 7 days; deletes
   * unattached images older than 24h (both DB rows and stored files).
   */
  async cleanupExpiredData(now = new Date()): Promise<CleanupResult> {
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
    const oneDayAgo = new Date(now.getTime() - DAY_MS);

    const [otpRequests, refreshTokens, pickupTokens] = await Promise.all([
      this.prisma.otpRequest.deleteMany({ where: { expiresAt: { lt: sevenDaysAgo } } }),
      this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: sevenDaysAgo } } }),
      this.prisma.pickupToken.deleteMany({ where: { expiresAt: { lt: sevenDaysAgo } } }),
    ]);

    const orphanImages = await this.prisma.$queryRaw<{ id: string; storage_key: string }[]>`
      SELECT li.id, li.storage_key
        FROM listing_images li
       WHERE li.listing_id IS NULL
         AND li.created_at < ${oneDayAgo}
         AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.avatar_image_id = li.id)
         AND NOT EXISTS (SELECT 1 FROM reports r WHERE li.id = ANY(r.image_ids))`;

    let deletedImages = 0;
    if (orphanImages.length > 0) {
      const result = await this.prisma.listingImage.deleteMany({
        where: { id: { in: orphanImages.map((i) => i.id) } },
      });
      deletedImages = result.count;
      await Promise.allSettled(orphanImages.map((img) => this.media.remove(img.storage_key)));
    }

    return {
      otpRequests: otpRequests.count,
      refreshTokens: refreshTokens.count,
      pickupTokens: pickupTokens.count,
      images: deletedImages,
    };
  }

  /**
   * JOB-4: rebuilds `transaction_metrics` from `event_logs`, grouped by local Đà Nẵng date and
   * sellerId.
   */
  async rebuildMetrics(_now = new Date()): Promise<number> {
    const events = await this.prisma.eventLog.findMany({
      where: { event: { in: [...METRIC_EVENTS] } },
      orderBy: { at: 'asc' },
    });

    // Some RESERVATION_CANCELLED events (e.g. withdraw/block) may omit sellerId in data; resolve via reservations.
    const missingSellerReservationIds = new Set<string>();
    for (const ev of events) {
      const data = asRecord(ev.data);
      if (ev.entityType === 'reservation' && typeof data.sellerId !== 'string') {
        missingSellerReservationIds.add(ev.entityId);
      }
    }
    const reservationSellerMap = new Map<string, string>();
    if (missingSellerReservationIds.size > 0) {
      const rows = await this.prisma.reservation.findMany({
        where: { id: { in: [...missingSellerReservationIds] } },
        select: { id: true, sellerId: true },
      });
      for (const r of rows) reservationSellerMap.set(r.id, r.sellerId);
    }

    const buckets = new Map<string, MetricBucket>();
    const getBucket = (dateKey: string, sellerId: string): MetricBucket => {
      const key = `${dateKey}:${sellerId}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          date: new Date(`${dateKey}T00:00:00.000Z`),
          sellerId,
          listingsPublished: 0,
          listingsExpiredWithStock: 0,
          portionsListed: 0,
          portionsReserved: 0,
          portionsHandedOver: 0,
          reservationsCreated: 0,
          reservationsCompleted: 0,
          reservationsCancelled: 0,
          reservationsExpired: 0,
          discountRateSum: 0,
          discountSamples: 0,
        };
        buckets.set(key, bucket);
      }
      return bucket;
    };

    for (const ev of events) {
      const data = asRecord(ev.data);
      const dateKey = localDate(ev.at);
      const sellerId =
        typeof data.sellerId === 'string'
          ? data.sellerId
          : ev.event === 'LISTING_PUBLISHED' && ev.actorId
            ? ev.actorId
            : ev.entityType === 'reservation'
              ? reservationSellerMap.get(ev.entityId)
              : undefined;
      if (!sellerId) continue;

      const bucket = getBucket(dateKey, sellerId);
      switch (ev.event) {
        case 'LISTING_PUBLISHED':
          bucket.listingsPublished += 1;
          bucket.portionsListed += toInt(data.quantityTotal);
          break;
        case 'LISTING_EXPIRED':
          if (data.expiredWithStock === true || toInt(data.quantityAvailable) > 0) {
            bucket.listingsExpiredWithStock += 1;
          }
          break;
        case 'RESERVATION_CREATED':
          bucket.reservationsCreated += 1;
          bucket.portionsReserved += toInt(data.quantity);
          break;
        case 'RESERVATION_COMPLETED': {
          bucket.reservationsCompleted += 1;
          bucket.portionsHandedOver += toInt(data.quantity);
          const discount = extractDiscountRate(data);
          if (discount !== null) {
            bucket.discountRateSum += discount;
            bucket.discountSamples += 1;
          }
          break;
        }
        case 'RESERVATION_CANCELLED':
          bucket.reservationsCancelled += 1;
          break;
        case 'RESERVATION_EXPIRED':
          bucket.reservationsExpired += 1;
          break;
      }
    }

    const rows = [...buckets.values()];
    await this.prisma.$transaction(async (tx) => {
      await tx.transactionMetric.deleteMany({});
      if (rows.length > 0) {
        await tx.transactionMetric.createMany({ data: rows });
      }
    });
    return rows.length;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function extractDiscountRate(data: Record<string, unknown>): number | null {
  if (typeof data.discountRate === 'number' && Number.isFinite(data.discountRate)) {
    return data.discountRate;
  }
  if (
    typeof data.originalPrice === 'number' &&
    Number.isFinite(data.originalPrice) &&
    data.originalPrice > 0 &&
    typeof data.unitPrice === 'number' &&
    Number.isFinite(data.unitPrice)
  ) {
    return (data.originalPrice - data.unitPrice) / data.originalPrice;
  }
  return null;
}
