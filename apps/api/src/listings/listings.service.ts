import { Injectable } from '@nestjs/common';
import { Prisma, type FoodListing } from '@prisma/client';
import type { ListingOwnerView, ListingStatus, PageInfo } from '@savemeal/shared';
import type { AuthAccount } from '../auth/auth.guard';
import { AppException } from '../common/errors/app-exception';
import { logEvent } from '../common/event-log';
import { decodeCursor, DEFAULT_LIMIT, paginate } from '../common/pagination';
import { AppConfig } from '../config/app-config';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateListingDto, DeclarationDto, MyListingsQuery, UpdateListingDto, WithdrawListingDto } from './listing.dto';
import { LISTING_INCLUDE, toDetail, toOwnerView, type ListingRow, type PortionCounts } from './listing.mapper';
import { isTooOld, missingChecklist, missingDeclarations, PUBLISHED_EDITABLE, TERMINAL } from './listing-rules';

type Tx = Prisma.TransactionClient;
type ListingData = Prisma.FoodListingUncheckedUpdateInput;

const PUBLISH_PER_HOUR = 10;

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly payments: PaymentsService,
  ) {}

  // ------------------------------------------------------------------------------------------
  // Read helpers
  // ------------------------------------------------------------------------------------------

  async loadRow(id: string, tx: Tx | PrismaService = this.prisma): Promise<ListingRow | null> {
    return tx.foodListing.findUnique({ where: { id }, include: LISTING_INCLUDE });
  }

  async portionCounts(ids: string[]): Promise<Map<string, PortionCounts>> {
    const groups = await this.prisma.reservation.groupBy({
      by: ['listingId', 'status'],
      where: { listingId: { in: ids }, status: { in: ['PENDING_PAYMENT', 'RESERVED', 'COMPLETED'] } },
      _sum: { quantity: true },
    });
    const map = new Map<string, PortionCounts>(ids.map((id) => [id, { reserved: 0, completed: 0 }]));
    for (const g of groups) {
      const counts = map.get(g.listingId)!;
      if (g.status === 'PENDING_PAYMENT' || g.status === 'RESERVED') counts.reserved += g._sum.quantity ?? 0;
      else counts.completed = g._sum.quantity ?? 0;
    }
    return map;
  }

  async ownerView(id: string): Promise<ListingOwnerView> {
    const row = await this.loadRow(id);
    if (!row) throw new AppException('LISTING_NOT_FOUND');
    const counts = (await this.portionCounts([id])).get(id)!;
    return toOwnerView(row, counts, new Date(), this.config.listings.maxWindowHours);
  }

  /** Loads a listing the caller owns; others get 404 (or 403 if the listing is public anyway). */
  private async ownedListing(account: AuthAccount, id: string, tx: Tx | PrismaService = this.prisma): Promise<FoodListing> {
    const listing = await tx.foodListing.findUnique({ where: { id } });
    if (!listing) throw new AppException('LISTING_NOT_FOUND');
    if (listing.sellerId !== account.id) {
      throw new AppException(listing.status === 'PUBLISHED' ? 'FORBIDDEN' : 'LISTING_NOT_FOUND');
    }
    return listing;
  }

  // ------------------------------------------------------------------------------------------
  // LIST-2
  // ------------------------------------------------------------------------------------------

  /**
   * LIST-2. Public for PUBLISHED listings of active sellers (including sold-out and under-review
   * ones). The owner and admins get the owner view for any status; a buyer with a reservation on
   * a closed listing still gets the detail.
   */
  async get(viewer: AuthAccount | undefined, id: string) {
    await this.payments.expirePendingPayments(undefined, { listingId: id });
    const row = await this.loadRow(id);
    if (!row) throw new AppException('LISTING_NOT_FOUND');
    if (viewer && (viewer.id === row.sellerId || viewer.role === 'ADMIN')) return this.ownerView(id);

    const mine = viewer
      ? await this.prisma.reservation.findMany({
          where: { listingId: id, buyerId: viewer.id },
          select: { id: true, status: true },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const publicVisible = row.status === 'PUBLISHED' && row.seller.status === 'ACTIVE';
    if (!publicVisible && mine.length === 0) throw new AppException('LISTING_NOT_FOUND');
    return toDetail(row, mine.find((r) => r.status === 'RESERVED' || r.status === 'PENDING_PAYMENT')?.id ?? null);
  }

  // ------------------------------------------------------------------------------------------
  // LIST-3 / LIST-4 / LIST-5
  // ------------------------------------------------------------------------------------------

  /** LIST-3. At most MAX_ACTIVE_LISTINGS non-terminal listings per seller. */
  async create(account: AuthAccount, dto: CreateListingDto): Promise<ListingOwnerView> {
    const id = await this.prisma.$transaction(async (tx) => {
      // Serialises listing creation per seller so the limit cannot be raced.
      const [seller] = await tx.$queryRaw<
        { default_pickup_address: string | null; default_pickup_lat: number | null; default_pickup_lng: number | null }[]
      >`SELECT default_pickup_address, default_pickup_lat, default_pickup_lng FROM accounts WHERE id = ${account.id}::uuid FOR UPDATE`;
      const active = await tx.foodListing.count({ where: { sellerId: account.id, status: { in: ['DRAFT', 'PUBLISHED'] } } });
      if (active >= this.config.listings.maxActivePerSeller) throw new AppException('LISTING_LIMIT');

      const data = this.inputToData(dto);
      if (!dto.pickup && seller?.default_pickup_address) {
        data.pickupAddress = seller.default_pickup_address;
        data.pickupLat = seller.default_pickup_lat;
        data.pickupLng = seller.default_pickup_lng;
      }
      this.assertConsistent({} as FoodListing, data);
      const created = await tx.foodListing.create({
        data: { ...(data as Prisma.FoodListingUncheckedCreateInput), sellerId: account.id, title: dto.title, category: dto.category },
      });
      if (dto.imageIds) await this.attachImages(tx, account.id, created.id, dto.imageIds);
      await logEvent(tx, {
        actorId: account.id,
        actorType: 'USER',
        event: 'LISTING_CREATED',
        entityType: 'listing',
        entityId: created.id,
      });
      return created.id;
    });
    return this.ownerView(id);
  }

  /**
   * LIST-4. Drafts accept any field. On PUBLISHED only the D§3 editable fields may change:
   * quantity never below the reserved count (atomic), price only down, pickup end only earlier.
   */
  async update(account: AuthAccount, id: string, dto: UpdateListingDto): Promise<ListingOwnerView> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM food_listings WHERE id = ${id}::uuid FOR UPDATE`;
      const listing = await this.ownedListing(account, id, tx);
      if (TERMINAL.includes(listing.status)) {
        throw new AppException('INVALID_STATE_TRANSITION', { from: listing.status, action: 'update' });
      }
      const data = this.inputToData(dto);

      if (listing.status === 'PUBLISHED') {
        const locked = this.lockedChanges(listing, dto);
        if (locked.length > 0) throw new AppException('FIELD_LOCKED', { fields: locked });
        if (dto.price !== undefined && dto.price > (listing.price ?? 0)) throw new AppException('PRICE_INCREASE_NOT_ALLOWED');
        if (dto.pickupEnd !== undefined) {
          const end = new Date(dto.pickupEnd);
          if (end.getTime() > listing.pickupEnd!.getTime()) throw new AppException('PICKUP_WINDOW_EXTENSION_NOT_ALLOWED');
          if (end.getTime() <= Date.now() || end.getTime() <= listing.pickupStart!.getTime()) {
            throw new AppException('VALIDATION_FAILED', { fields: { pickupEnd: 'must be in the future and after pickupStart' } });
          }
        }
        if (dto.imageIds !== undefined && dto.imageIds.length === 0) {
          throw new AppException('VALIDATION_FAILED', { fields: { imageIds: 'a published listing needs a photo' } });
        }
        if (dto.quantityTotal !== undefined) {
          // Raising or lowering the total moves the available stock by the same amount, and never
          // below what is already reserved or handed over (CHECK constraint backs this up).
          const changed = await tx.$executeRaw`
            UPDATE food_listings
               SET quantity_available = quantity_available + (${dto.quantityTotal}::int - quantity_total),
                   quantity_total = ${dto.quantityTotal}::int, updated_at = now()
             WHERE id = ${id}::uuid AND quantity_total - quantity_available <= ${dto.quantityTotal}::int`;
          if (changed !== 1) throw new AppException('QUANTITY_BELOW_RESERVED');
          delete data.quantityTotal;
        }
      }

      this.assertConsistent(listing, data);
      await tx.foodListing.update({ where: { id }, data });
      if (dto.imageIds !== undefined) await this.attachImages(tx, account.id, id, dto.imageIds);
    });
    return this.ownerView(id);
  }

  /** LIST-5. Drafts only (hard delete); their images become unattached. */
  async remove(account: AuthAccount, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const listing = await this.ownedListing(account, id, tx);
      if (listing.status !== 'DRAFT') {
        throw new AppException('INVALID_STATE_TRANSITION', { from: listing.status, action: 'delete' });
      }
      await tx.listingImage.updateMany({ where: { listingId: id }, data: { listingId: null } });
      const deleted = await tx.foodListing.deleteMany({ where: { id, status: 'DRAFT' } });
      if (deleted.count !== 1) throw new AppException('INVALID_STATE_TRANSITION', { from: listing.status, action: 'delete' });
      await logEvent(tx, { actorId: account.id, actorType: 'USER', event: 'LISTING_DELETED', entityType: 'listing', entityId: id });
    });
  }

  // ------------------------------------------------------------------------------------------
  // LIST-6 / LIST-7
  // ------------------------------------------------------------------------------------------

  /**
   * LIST-6. DRAFT → PUBLISHED only with the full checklist and all 6 declarations true. There is
   * no other path to PUBLISHED and no override (CLAUDE.md §6).
   */
  async publish(account: AuthAccount, id: string, declaration: DeclarationDto): Promise<ListingOwnerView> {
    const recent = await this.prisma.eventLog.count({
      where: { actorId: account.id, event: 'LISTING_PUBLISHED', at: { gt: new Date(Date.now() - 3600_000) } },
    });
    if (recent >= PUBLISH_PER_HOUR) throw AppException.rateLimited(3600_000);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM food_listings WHERE id = ${id}::uuid FOR UPDATE`;
      const listing = await this.ownedListing(account, id, tx);
      if (listing.status !== 'DRAFT') {
        throw new AppException('INVALID_STATE_TRANSITION', { from: listing.status, action: 'publish' });
      }
      const now = new Date();
      const imageCount = await tx.listingImage.count({ where: { listingId: id } });
      const missing = missingChecklist({ ...listing, imageCount }, now, this.config.listings.maxWindowHours);
      if (missing.length > 0) throw new AppException('LISTING_INCOMPLETE', { missing });
      const undeclared = missingDeclarations(declaration as Record<string, unknown>);
      if (undeclared.length > 0) throw new AppException('DECLARATION_INCOMPLETE', { missing: undeclared });
      if (listing.pickupEnd!.getTime() <= now.getTime()) throw new AppException('PICKUP_WINDOW_INVALID');
      if (isTooOld(listing.preparedAt!, listing.pickupEnd!, this.config.maxListingAgeHoursFor(listing.category))) {
        throw new AppException('LISTING_TOO_OLD');
      }

      const declared = Object.fromEntries(Object.entries(declaration).filter(([, v]) => v === true));
      const updated = await tx.foodListing.updateMany({
        where: { id, status: 'DRAFT' },
        data: {
          status: 'PUBLISHED',
          quantityAvailable: listing.quantityTotal!,
          publishedAt: now,
          declaredAt: now,
          declaration: declared,
        },
      });
      if (updated.count !== 1) throw new AppException('INVALID_STATE_TRANSITION', { from: 'DRAFT', action: 'publish' });
      await logEvent(tx, {
        actorId: account.id,
        actorType: 'USER',
        event: 'LISTING_PUBLISHED',
        entityType: 'listing',
        entityId: id,
        data: {
          declaration: declared,
          quantityTotal: listing.quantityTotal,
          price: listing.price,
          originalPrice: listing.originalPrice,
          timeToPublishSec: Math.round((now.getTime() - listing.createdAt.getTime()) / 1000),
        },
      });
    });
    return this.ownerView(id);
  }

  /** LIST-7. DRAFT|PUBLISHED → WITHDRAWN; RESERVED orders are cancelled (SELLER_WITHDREW). */
  async withdraw(account: AuthAccount, id: string, dto: WithdrawListingDto): Promise<ListingOwnerView> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM food_listings WHERE id = ${id}::uuid FOR UPDATE`;
      const listing = await this.ownedListing(account, id, tx);
      if (listing.status !== 'DRAFT' && listing.status !== 'PUBLISHED') {
        throw new AppException('INVALID_STATE_TRANSITION', { from: listing.status, action: 'withdraw' });
      }
      const closeReason = dto.note ? `${dto.reason}: ${dto.note}` : dto.reason;
      await tx.foodListing.update({ where: { id }, data: { status: 'WITHDRAWN', closedAt: new Date(), closeReason } });
      await logEvent(tx, {
        actorId: account.id,
        actorType: 'USER',
        event: 'LISTING_WITHDRAWN',
        entityType: 'listing',
        entityId: id,
        data: { reason: dto.reason, quantityAvailable: listing.quantityAvailable },
      });
      await this.cancelActiveReservations(tx, id, 'SELLER_WITHDREW', account.id, 'USER');
    });
    return this.ownerView(id);
  }

  /**
   * Cancels every PENDING_PAYMENT and RESERVED order of a closed listing, revokes their pickup
   * tokens, expires UNPAID payments, and marks PAID payments as REFUND_DUE. Stock is not released:
   * the listing is closed (D§4). Shared with admin block (M5).
   */
  async cancelActiveReservations(
    tx: Tx,
    listingId: string,
    reason: 'SELLER_WITHDREW' | 'LISTING_BLOCKED',
    actorId: string | null,
    actorType: 'USER' | 'ADMIN' | 'SYSTEM',
  ): Promise<number> {
    const now = new Date();
    const cancelled = await tx.$queryRaw<{ id: string }[]>`
      UPDATE reservations
         SET status = 'CANCELLED', cancel_reason = ${reason}::"CancelReason", closed_at = ${now}, updated_at = ${now}
       WHERE listing_id = ${listingId}::uuid AND status IN ('PENDING_PAYMENT', 'RESERVED')
      RETURNING id`;
    if (cancelled.length === 0) return 0;
    const ids = cancelled.map((r) => r.id);
    await tx.pickupToken.updateMany({
      where: { reservationId: { in: ids }, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });

    const idParams = ids.map((id) => Prisma.sql`${id}::uuid`);
    const expiredPayments = await tx.$queryRaw<{ id: string; reservation_id: string }[]>`
      UPDATE payments
         SET status = 'EXPIRED', updated_at = ${now}
       WHERE reservation_id IN (${Prisma.join(idParams)})
         AND status = 'UNPAID'
      RETURNING id, reservation_id`;

    const refundDuePayments = await tx.$queryRaw<{ id: string; reservation_id: string }[]>`
      UPDATE payments
         SET status = 'REFUND_DUE', refund_note = ${reason}, updated_at = ${now}
       WHERE reservation_id IN (${Prisma.join(idParams)})
         AND status = 'PAID'
      RETURNING id, reservation_id`;

    for (const payment of expiredPayments) {
      await logEvent(tx, {
        actorId,
        actorType,
        event: 'PAYMENT_EXPIRED',
        entityType: 'payment',
        entityId: payment.id,
        data: { reservationId: payment.reservation_id, reason },
      });
    }
    for (const payment of refundDuePayments) {
      await logEvent(tx, {
        actorId,
        actorType,
        event: 'PAYMENT_REFUND_DUE',
        entityType: 'payment',
        entityId: payment.id,
        data: { reservationId: payment.reservation_id, reason },
      });
    }
    for (const reservationId of ids) {
      await logEvent(tx, {
        actorId,
        actorType,
        event: 'RESERVATION_CANCELLED',
        entityType: 'reservation',
        entityId: reservationId,
        data: { reason, listingId },
      });
    }
    return ids.length;
  }

  // ------------------------------------------------------------------------------------------
  // LIST-8
  // ------------------------------------------------------------------------------------------

  /** LIST-8. `active` = DRAFT and PUBLISHED, `done` = terminal; newest first. */
  async mine(account: AuthAccount, query: MyListingsQuery): Promise<{ data: ListingOwnerView[]; page: PageInfo }> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = decodeCursor(query.cursor);
    const statuses: ListingStatus[] = query.tab === 'done' ? [...TERMINAL] : ['DRAFT', 'PUBLISHED'];
    const rows = await this.prisma.foodListing.findMany({
      where: { sellerId: account.id, status: { in: statuses } },
      include: LISTING_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
    });
    const { items, page } = paginate(rows, offset, limit);
    const counts = await this.portionCounts(items.map((r) => r.id));
    const now = new Date();
    return {
      data: items.map((r) => toOwnerView(r, counts.get(r.id)!, now, this.config.listings.maxWindowHours)),
      page,
    };
  }

  // ------------------------------------------------------------------------------------------
  // Input helpers
  // ------------------------------------------------------------------------------------------

  private inputToData(dto: UpdateListingDto | CreateListingDto): ListingData {
    const data: ListingData = {};
    const copy = ['title', 'description', 'category', 'origin', 'storage', 'storageNote', 'ingredients', 'allergens', 'originalPrice', 'price', 'quantityTotal'] as const;
    for (const key of copy) {
      if (dto[key] !== undefined) (data as Record<string, unknown>)[key] = dto[key];
    }
    if (dto.origin !== undefined) data.origin = dto.origin.trim();
    if (dto.preparedAt !== undefined) data.preparedAt = new Date(dto.preparedAt);
    if (dto.pickupStart !== undefined) data.pickupStart = new Date(dto.pickupStart);
    if (dto.pickupEnd !== undefined) data.pickupEnd = new Date(dto.pickupEnd);
    if (dto.pickup !== undefined) {
      data.pickupAddress = dto.pickup.address.trim();
      data.pickupLat = dto.pickup.lat;
      data.pickupLng = dto.pickup.lng;
    }
    return data;
  }

  /** Cross-field checks on the merged values (the CHECK constraints back these up). */
  private assertConsistent(current: Partial<FoodListing>, data: ListingData): void {
    const pick = <K extends keyof FoodListing>(k: K) => (k in data ? (data as Partial<FoodListing>)[k] : current[k]) ?? null;
    const start = pick('pickupStart') as Date | null;
    const end = pick('pickupEnd') as Date | null;
    const fields: Record<string, string> = {};
    if (start && end && start.getTime() >= end.getTime()) fields.pickupEnd = 'must be after pickupStart';
    const price = pick('price') as number | null;
    const original = pick('originalPrice') as number | null;
    if (price !== null && original !== null && price > original) fields.price = 'must not exceed originalPrice';
    if (Object.keys(fields).length > 0) throw new AppException('VALIDATION_FAILED', { fields });
  }

  /** Fields in the request that would change a locked value on a PUBLISHED listing. */
  private lockedChanges(listing: FoodListing, dto: UpdateListingDto): string[] {
    const sameTime = (a: Date | null, b: string) => a !== null && a.getTime() === new Date(b).getTime();
    const changes: Record<string, boolean> = {
      category: dto.category !== undefined && dto.category !== listing.category,
      origin: dto.origin !== undefined && dto.origin.trim() !== listing.origin,
      preparedAt: dto.preparedAt !== undefined && !sameTime(listing.preparedAt, dto.preparedAt),
      storage: dto.storage !== undefined && dto.storage !== listing.storage,
      storageNote: dto.storageNote !== undefined && dto.storageNote !== listing.storageNote,
      ingredients: dto.ingredients !== undefined && dto.ingredients !== listing.ingredients,
      allergens:
        dto.allergens !== undefined && [...dto.allergens].sort().join() !== [...listing.allergens].sort().join(),
      originalPrice: dto.originalPrice !== undefined && dto.originalPrice !== listing.originalPrice,
      pickupStart: dto.pickupStart !== undefined && !sameTime(listing.pickupStart, dto.pickupStart),
      pickup:
        dto.pickup !== undefined &&
        (dto.pickup.address.trim() !== listing.pickupAddress ||
          dto.pickup.lat !== listing.pickupLat ||
          dto.pickup.lng !== listing.pickupLng),
    };
    return Object.entries(changes)
      .filter(([field, changed]) => changed && !(PUBLISHED_EDITABLE as readonly string[]).includes(field))
      .map(([field]) => field);
  }

  /** Attaches the caller's LISTING images in order (max 4); images no longer listed are detached. */
  private async attachImages(tx: Tx, uploaderId: string, listingId: string, imageIds: string[]): Promise<void> {
    const unique = [...new Set(imageIds)];
    const images = await tx.listingImage.findMany({
      where: { id: { in: unique }, uploaderId, purpose: 'LISTING', OR: [{ listingId: null }, { listingId }] },
      select: { id: true },
    });
    if (images.length !== unique.length) {
      throw new AppException('VALIDATION_FAILED', { fields: { imageIds: 'unknown image, or not your LISTING upload' } });
    }
    await tx.listingImage.updateMany({ where: { listingId, id: { notIn: unique } }, data: { listingId: null } });
    for (const [position, id] of unique.entries()) {
      await tx.listingImage.update({ where: { id }, data: { listingId, position } });
    }
  }
}
