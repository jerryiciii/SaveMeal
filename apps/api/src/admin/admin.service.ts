import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  formatOrderCode,
  type AccountStatus,
  type AdminAccount,
  type AdminAccountStatusResponse,
  type AdminMetrics,
  type AdminSellerVerificationResponse,
  type ListingOwnerView,
  type PageInfo,
  type Report,
  type Reservation,
} from '@savemeal/shared';
import type { AuthAccount } from '../auth/auth.guard';
import { AppException } from '../common/errors/app-exception';
import { logEvent } from '../common/event-log';
import { toImage } from '../common/images';
import { decodeCursor, DEFAULT_LIMIT, paginate } from '../common/pagination';
import { localDayStart, toApiTime, toApiTimeOrNull } from '../common/time';
import { AppConfig } from '../config/app-config';
import { LISTING_INCLUDE, pickupOf, sellerSummary, toOwnerView } from '../listings/listing.mapper';
import { ListingsService } from '../listings/listings.service';
import { toMeSeller } from '../me/me.service';
import { PrismaService } from '../prisma/prisma.service';
import { loadReportImagesMap, toReport } from '../reports/report.mapper';
import type {
  AdminAccountStatusDto,
  AdminAccountsQuery,
  AdminBlockListingDto,
  AdminListingsQuery,
  AdminMetricsQuery,
  AdminReportsQuery,
  AdminReservationsQuery,
  AdminSellerVerificationDto,
  AdminUpdateReportDto,
} from './admin.dto';
import { computeAdminMetrics } from './metrics';

type Tx = Prisma.TransactionClient;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly listings: ListingsService,
  ) {}

  // ------------------------------------------------------------------------------------------
  // ADM-1 · GET /admin/reports
  // ------------------------------------------------------------------------------------------

  async listReports(query: AdminReportsQuery): Promise<{ data: Report[]; page: PageInfo }> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = decodeCursor(query.cursor);
    const where: Prisma.ReportWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;

    const rows = await this.prisma.report.findMany({
      where,
      include: { reporter: { select: { id: true, displayName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
    });
    const { items, page } = paginate(rows, offset, limit);
    const imagesMap = await loadReportImagesMap(this.prisma, items);
    return {
      data: items.map((row) => toReport(row, imagesMap, true)),
      page,
    };
  }

  // ------------------------------------------------------------------------------------------
  // ADM-2 · PATCH /admin/reports/:reportId
  // ------------------------------------------------------------------------------------------

  async updateReport(admin: AuthAccount, reportId: string, dto: AdminUpdateReportDto): Promise<Report> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const report = await tx.report.findUnique({ where: { id: reportId } });
      if (!report) throw new AppException('REPORT_NOT_FOUND');

      const now = new Date();
      const isClosing = dto.status === 'RESOLVED' || dto.status === 'DISMISSED';
      const resolutionText = dto.resolution.trim();

      if (dto.action === 'LISTING_BLOCKED') {
        if (!report.listingId) {
          throw new AppException('VALIDATION_FAILED', {
            fields: { action: 'report has no listing to block' },
          });
        }
        await this.blockListingInTx(tx, admin, report.listingId, resolutionText || 'Blocked via report');
      } else if (dto.action === 'ACCOUNT_SUSPENDED') {
        await this.setAccountStatusInTx(
          tx,
          admin,
          report.reportedAccountId,
          'SUSPENDED',
          resolutionText || 'Suspended via report',
        );
      }

      if (dto.clearReview && report.listingId && dto.action !== 'LISTING_BLOCKED') {
        await tx.foodListing.updateMany({
          where: { id: report.listingId, underReview: true },
          data: { underReview: false },
        });
      }

      const saved = await tx.report.update({
        where: { id: reportId },
        data: {
          status: dto.status,
          action: dto.action,
          resolution: resolutionText || null,
          handledBy: admin.id,
          ...(isClosing ? { handledAt: report.handledAt ?? now } : {}),
        },
        include: { reporter: { select: { id: true, displayName: true } } },
      });

      await logEvent(tx, {
        actorId: admin.id,
        actorType: 'ADMIN',
        event: 'REPORT_HANDLED',
        entityType: 'report',
        entityId: reportId,
        data: {
          status: dto.status,
          action: dto.action,
          clearReview: dto.clearReview,
          listingId: report.listingId,
          reportedAccountId: report.reportedAccountId,
        },
      });

      return saved;
    });

    const imagesMap = await loadReportImagesMap(this.prisma, [updated]);
    return toReport(updated, imagesMap, true);
  }

  // ------------------------------------------------------------------------------------------
  // ADM-3 · POST /admin/listings/:listingId/block
  // ------------------------------------------------------------------------------------------

  async blockListing(
    admin: AuthAccount,
    listingId: string,
    dto: AdminBlockListingDto,
  ): Promise<ListingOwnerView> {
    await this.prisma.$transaction(async (tx) => {
      await this.blockListingInTx(tx, admin, listingId, dto.reason);
    });
    return this.listings.ownerView(listingId);
  }

  private async blockListingInTx(
    tx: Tx,
    admin: AuthAccount,
    listingId: string,
    reason: string,
  ): Promise<void> {
    await tx.$executeRaw`SELECT 1 FROM food_listings WHERE id = ${listingId}::uuid FOR UPDATE`;
    const listing = await tx.foodListing.findUnique({ where: { id: listingId } });
    if (!listing) throw new AppException('LISTING_NOT_FOUND');
    if (listing.status !== 'PUBLISHED' && listing.status !== 'EXPIRED') {
      throw new AppException('INVALID_STATE_TRANSITION', { from: listing.status, action: 'block' });
    }

    await tx.foodListing.update({
      where: { id: listingId },
      data: {
        status: 'BLOCKED',
        blockedReason: reason,
        closedAt: listing.closedAt ?? new Date(),
        underReview: false,
      },
    });

    const cancelledReservations = await this.listings.cancelActiveReservations(
      tx,
      listingId,
      'LISTING_BLOCKED',
      admin.id,
      'ADMIN',
    );

    await logEvent(tx, {
      actorId: admin.id,
      actorType: 'ADMIN',
      event: 'LISTING_BLOCKED',
      entityType: 'listing',
      entityId: listingId,
      data: { reason, previousStatus: listing.status, cancelledReservations },
    });
  }

  // ------------------------------------------------------------------------------------------
  // ADM-4 · POST /admin/accounts/:accountId/status
  // ------------------------------------------------------------------------------------------

  async setAccountStatus(
    admin: AuthAccount,
    accountId: string,
    dto: AdminAccountStatusDto,
  ): Promise<AdminAccountStatusResponse> {
    return this.prisma.$transaction((tx) =>
      this.setAccountStatusInTx(tx, admin, accountId, dto.status, dto.reason),
    );
  }

  private async setAccountStatusInTx(
    tx: Tx,
    admin: AuthAccount,
    accountId: string,
    status: AccountStatus,
    reason: string,
  ): Promise<AdminAccountStatusResponse> {
    const account = await tx.account.findUnique({ where: { id: accountId } });
    if (!account || account.status === 'DELETED') {
      throw new AppException('ACCOUNT_NOT_FOUND');
    }

    await tx.account.update({
      where: { id: accountId },
      data: {
        status,
        suspendedReason: status === 'SUSPENDED' ? reason : null,
      },
    });

    if (status === 'SUSPENDED') {
      await tx.refreshToken.updateMany({
        where: { accountId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await logEvent(tx, {
      actorId: admin.id,
      actorType: 'ADMIN',
      event: 'ACCOUNT_STATUS_CHANGED',
      entityType: 'account',
      entityId: accountId,
      data: { from: account.status, to: status, reason },
    });

    return { id: accountId, status };
  }

  // ------------------------------------------------------------------------------------------
  // ADM-5 · POST /admin/accounts/:accountId/seller-verification
  // ------------------------------------------------------------------------------------------

  async setSellerVerification(
    admin: AuthAccount,
    accountId: string,
    dto: AdminSellerVerificationDto,
  ): Promise<AdminSellerVerificationResponse> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const account = await tx.account.findUnique({ where: { id: accountId } });
      if (!account || account.status === 'DELETED') {
        throw new AppException('ACCOUNT_NOT_FOUND');
      }

      const saved = await tx.account.update({
        where: { id: accountId },
        data: dto.verified
          ? { sellerVerifiedAt: new Date(), sellerVerifiedBy: admin.id }
          : { sellerVerifiedAt: null, sellerVerifiedBy: null },
        include: { bankQrImage: { select: { id: true, storageKey: true, width: true, height: true } } },
      });

      await logEvent(tx, {
        actorId: admin.id,
        actorType: 'ADMIN',
        event: 'SELLER_VERIFICATION_CHANGED',
        entityType: 'account',
        entityId: accountId,
        data: { verified: dto.verified, note: dto.note ?? '' },
      });

      return saved;
    });

    return { id: updated.id, seller: toMeSeller(updated) };
  }

  // ------------------------------------------------------------------------------------------
  // ADM-6 · GET /admin/accounts
  // ------------------------------------------------------------------------------------------

  async listAccounts(query: AdminAccountsQuery): Promise<{ data: AdminAccount[]; page: PageInfo }> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = decodeCursor(query.cursor);
    const andFilters: Prisma.AccountWhereInput[] = [];

    if (query.status) {
      andFilters.push({ status: query.status });
    } else {
      andFilters.push({ status: { not: 'DELETED' } });
    }

    const q = query.q?.trim();
    if (q) {
      andFilters.push({
        OR: [
          { displayName: { contains: q, mode: 'insensitive' } },
          { sellerName: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      });
    }

    if (query.sellerOnly) {
      andFilters.push({
        OR: [
          { sellerName: { not: null } },
          { sellerType: { not: null } },
          { sellerVerifiedAt: { not: null } },
          { listings: { some: {} } },
        ],
      });
    }

    const rows = await this.prisma.account.findMany({
      where: { AND: andFilters },
      include: { bankQrImage: { select: { id: true, storageKey: true, width: true, height: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
    });
    const { items, page } = paginate(rows, offset, limit);

    return {
      data: items.map((a) => ({
        id: a.id,
        displayName: a.displayName,
        phone: a.phone,
        email: a.email,
        status: a.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
        seller: toMeSeller(a),
        createdAt: toApiTime(a.createdAt),
      })),
      page,
    };
  }

  // ------------------------------------------------------------------------------------------
  // ADM-7 · GET /admin/listings
  // ------------------------------------------------------------------------------------------

  async listListings(query: AdminListingsQuery): Promise<{ data: ListingOwnerView[]; page: PageInfo }> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = decodeCursor(query.cursor);
    const createdAt = this.parseDateRange(query.from, query.to);

    const where: Prisma.FoodListingWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.underReview !== undefined) where.underReview = query.underReview;
    if (query.sellerId) where.sellerId = query.sellerId;
    if (createdAt) where.createdAt = createdAt;

    const rows = await this.prisma.foodListing.findMany({
      where,
      include: LISTING_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
    });
    const { items, page } = paginate(rows, offset, limit);
    const counts = items.length > 0 ? await this.listings.portionCounts(items.map((r) => r.id)) : new Map();
    const now = new Date();

    return {
      data: items.map((r) =>
        toOwnerView(
          r,
          counts.get(r.id) ?? { reserved: 0, completed: 0 },
          now,
          this.config.listings.maxWindowHours,
          this.config.features.payments,
        ),
      ),
      page,
    };
  }

  // ------------------------------------------------------------------------------------------
  // ADM-8 · GET /admin/reservations
  // ------------------------------------------------------------------------------------------

  async listReservations(query: AdminReservationsQuery): Promise<{ data: Reservation[]; page: PageInfo }> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = decodeCursor(query.cursor);
    const createdAt = this.parseDateRange(query.from, query.to);

    const where: Prisma.ReservationWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.sellerId) where.sellerId = query.sellerId;
    if (createdAt) where.createdAt = createdAt;

    const rows = await this.prisma.reservation.findMany({
      where,
      include: {
        listing: {
          include: {
            images: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], take: 1 },
          },
        },
        seller: true,
        buyer: { select: { displayName: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
    });
    const { items, page } = paginate(rows, offset, limit);

    return {
      data: items.map((r) => {
        const firstImage = r.listing.images[0];
        return {
          id: r.id,
          code: formatOrderCode(r.code),
          status: r.status,
          quantity: r.quantity,
          unitPrice: r.unitPrice,
          totalPrice: r.totalPrice,
          platformFee: r.platformFee,
          payableAmount: r.payableAmount || r.totalPrice,
          listing: {
            id: r.listing.id,
            title: r.listing.title,
            image: firstImage ? toImage(firstImage) : null,
            pickupStart: toApiTimeOrNull(r.listing.pickupStart)!,
            pickupEnd: toApiTimeOrNull(r.listing.pickupEnd)!,
            pickup: pickupOf(r.listing)!,
            status: r.listing.status,
          },
          seller: sellerSummary(r.seller),
          buyer: { displayName: r.buyer.displayName ?? 'Người mua' },
          // ADMIN never receives pickupToken (API_CONTRACT §9 ADM-8).
          pickupToken: null,
          payment: null,
          cancelReason: r.cancelReason,
          createdAt: toApiTime(r.createdAt),
          completedAt: toApiTimeOrNull(r.completedAt),
          closedAt: toApiTimeOrNull(r.closedAt),
          canCancel: false,
          canReport: false,
        };
      }),
      page,
    };
  }

  // ------------------------------------------------------------------------------------------
  // ADM-9 · GET /admin/metrics
  // ------------------------------------------------------------------------------------------

  async getMetrics(query: AdminMetricsQuery): Promise<AdminMetrics> {
    const now = new Date();
    const defaultFrom = localDayStart(now, -29);
    const defaultTo = localDayStart(now, 1);

    const parsed = this.parseDateRange(query.from, query.to);
    const rangeFilter: Prisma.DateTimeFilter = parsed ?? { gte: defaultFrom, lt: defaultTo };
    if (!rangeFilter.gte) rangeFilter.gte = defaultFrom;
    if (!rangeFilter.lt && !rangeFilter.lte) rangeFilter.lt = defaultTo;

    const sellerFilter = query.sellerId ? { sellerId: query.sellerId } : {};

    const [reservations, listings, reports] = await Promise.all([
      this.prisma.reservation.findMany({
        where: { ...sellerFilter, createdAt: rangeFilter },
        select: {
          status: true,
          quantity: true,
          unitPrice: true,
          listing: { select: { originalPrice: true } },
        },
      }),
      this.prisma.foodListing.findMany({
        where: { ...sellerFilter, publishedAt: rangeFilter },
        select: { status: true, quantityAvailable: true },
      }),
      this.prisma.report.findMany({
        where: {
          ...(query.sellerId ? { reportedAccountId: query.sellerId } : {}),
          createdAt: rangeFilter,
        },
        select: {
          type: true,
          status: true,
          action: true,
          createdAt: true,
          handledAt: true,
        },
      }),
    ]);

    return computeAdminMetrics({
      reservations: reservations.map((r) => ({
        status: r.status,
        quantity: r.quantity,
        unitPrice: r.unitPrice,
        listingOriginalPrice: r.listing.originalPrice,
      })),
      listings,
      reports,
    });
  }

  // ------------------------------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------------------------------

  private parseDateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
    if (!from && !to) return undefined;
    const fields: Record<string, string> = {};
    let gte: Date | undefined;
    let lt: Date | undefined;
    let lte: Date | undefined;

    if (from) {
      gte = DATE_ONLY_RE.test(from) ? new Date(`${from}T00:00:00.000+07:00`) : new Date(from);
      if (Number.isNaN(gte.getTime())) fields.from = 'invalid date';
    }
    if (to) {
      if (DATE_ONLY_RE.test(to)) {
        const start = new Date(`${to}T00:00:00.000+07:00`);
        if (Number.isNaN(start.getTime())) fields.to = 'invalid date';
        else lt = new Date(start.getTime() + DAY_MS);
      } else {
        lte = new Date(to);
        if (Number.isNaN(lte.getTime())) fields.to = 'invalid date';
      }
    }

    if (Object.keys(fields).length > 0) {
      throw new AppException('VALIDATION_FAILED', { fields });
    }

    const upper = lt ?? lte;
    if (gte && upper && gte.getTime() > upper.getTime()) {
      throw new AppException('VALIDATION_FAILED', { fields: { to: 'must not be before from' } });
    }

    return {
      ...(gte ? { gte } : {}),
      ...(lt ? { lt } : {}),
      ...(lte ? { lte } : {}),
    };
  }
}
