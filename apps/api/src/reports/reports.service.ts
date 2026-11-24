import { Injectable } from '@nestjs/common';
import type { Image, Report, ReportType } from '@savemeal/shared';
import type { AuthAccount } from '../auth/auth.guard';
import { AppException } from '../common/errors/app-exception';
import { logEvent } from '../common/event-log';
import { toImage } from '../common/images';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateReportDto } from './report.dto';
import { toReport } from './report.mapper';

const REPORTS_PER_DAY = 10;
const DAY_MS = 24 * 3600_000;
const BUYER_RESERVATION_TYPES: readonly ReportType[] = ['NOT_RECEIVED', 'SELLER_ABSENT'];

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * REP-1 · POST /reports.
   * Rate-limited to 10 reports per 24h per account. Validates targets, derives reportedAccountId,
   * validates REPORT-purpose images, and immediately flags `food_listings.under_review = true`
   * on `UNSAFE_FOOD` reports within the same transaction.
   */
  async create(account: AuthAccount, dto: CreateReportDto): Promise<Report> {
    const recentCount = await this.prisma.report.count({
      where: { reporterId: account.id, createdAt: { gt: new Date(Date.now() - DAY_MS) } },
    });
    if (recentCount >= REPORTS_PER_DAY) {
      throw AppException.rateLimited(DAY_MS);
    }

    const listingId = dto.listingId ?? null;
    const reservationId = dto.reservationId ?? null;
    const accountId = dto.accountId ?? null;

    if (!listingId && !reservationId && !accountId) {
      throw new AppException('REPORT_TARGET_INVALID');
    }
    if (BUYER_RESERVATION_TYPES.includes(dto.type) && !reservationId) {
      throw new AppException('REPORT_TARGET_INVALID');
    }

    const uniqueImageIds = [...new Set(dto.imageIds ?? [])];

    const { report, imagesMap } = await this.prisma.$transaction(async (tx) => {
      let resolvedListingId: string | null = listingId;
      let reportedAccountId: string;

      if (reservationId) {
        const reservation = await tx.reservation.findUnique({
          where: { id: reservationId },
          select: { id: true, listingId: true, buyerId: true, sellerId: true },
        });
        if (!reservation) throw new AppException('REPORT_TARGET_INVALID');

        const isBuyer = reservation.buyerId === account.id;
        const isSeller = reservation.sellerId === account.id;
        if (!isBuyer && !isSeller) throw new AppException('REPORT_TARGET_INVALID');
        if (BUYER_RESERVATION_TYPES.includes(dto.type) && !isBuyer) {
          throw new AppException('REPORT_TARGET_INVALID');
        }
        if (listingId !== null && listingId !== reservation.listingId) {
          throw new AppException('REPORT_TARGET_INVALID');
        }
        resolvedListingId = reservation.listingId;

        const counterpartId = isBuyer ? reservation.sellerId : reservation.buyerId;
        if (accountId !== null && accountId !== counterpartId) {
          throw new AppException('REPORT_TARGET_INVALID');
        }
        reportedAccountId = counterpartId;
      } else if (listingId) {
        const listing = await tx.foodListing.findUnique({
          where: { id: listingId },
          select: { id: true, sellerId: true },
        });
        if (!listing) throw new AppException('REPORT_TARGET_INVALID');
        if (accountId !== null && accountId !== listing.sellerId) {
          throw new AppException('REPORT_TARGET_INVALID');
        }
        resolvedListingId = listing.id;
        reportedAccountId = listing.sellerId;
      } else {
        const target = await tx.account.findUnique({
          where: { id: accountId! },
          select: { id: true, status: true },
        });
        if (!target || target.status === 'DELETED') {
          throw new AppException('REPORT_TARGET_INVALID');
        }
        reportedAccountId = target.id;
      }

      if (reportedAccountId === account.id) {
        throw new AppException('REPORT_TARGET_INVALID');
      }

      const imagesMap = new Map<string, Image>();
      if (uniqueImageIds.length > 0) {
        const images = await tx.listingImage.findMany({
          where: { id: { in: uniqueImageIds }, uploaderId: account.id, purpose: 'REPORT' },
          select: { id: true, storageKey: true, width: true, height: true },
        });
        if (images.length !== uniqueImageIds.length) {
          throw new AppException('VALIDATION_FAILED', {
            fields: { imageIds: 'unknown image, or not your REPORT upload' },
          });
        }
        for (const img of images) imagesMap.set(img.id, toImage(img));
      }

      const created = await tx.report.create({
        data: {
          reporterId: account.id,
          type: dto.type,
          listingId: resolvedListingId,
          reservationId,
          reportedAccountId,
          description: dto.description,
          imageIds: uniqueImageIds,
          status: 'OPEN',
        },
      });

      const underReviewTriggered = dto.type === 'UNSAFE_FOOD' && resolvedListingId !== null;
      if (dto.type === 'UNSAFE_FOOD' && resolvedListingId !== null) {
        await tx.foodListing.update({
          where: { id: resolvedListingId },
          data: { underReview: true },
        });
      }

      await logEvent(tx, {
        actorId: account.id,
        actorType: 'USER',
        event: 'REPORT_CREATED',
        entityType: 'report',
        entityId: created.id,
        data: {
          type: dto.type,
          listingId: resolvedListingId,
          reservationId,
          reportedAccountId,
          underReviewTriggered,
        },
      });

      return { report: created, imagesMap };
    });

    return toReport(report, imagesMap, false);
  }
}
