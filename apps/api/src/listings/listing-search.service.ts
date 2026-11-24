import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CATEGORIES, type Category, type ListingCard, type MapPin, type PageInfo } from '@savemeal/shared';
import { AppException } from '../common/errors/app-exception';
import { decodeCursor, DEFAULT_LIMIT, paginate } from '../common/pagination';
import { localWallTime } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';
import type { SearchListingsQuery } from './listing.dto';
import { LISTING_INCLUDE, toCard, toMapPin } from './listing.mapper';

/** contract SYS-2 `defaultCenter` */
export const DEFAULT_CENTER = { lat: 16.0544, lng: 108.2022 };
const DEFAULT_RADIUS_KM = 3;
const MAP_LIMIT = 200;
const EARTH_M = 6_371_000;

/**
 * SQL for "visible on the map" (D§3): PUBLISHED, not under review, ACTIVE seller, window not
 * over. Reused by RES-1's availability rules in spirit; keep them in sync.
 */
export const VISIBLE_SQL = Prisma.sql`
  l.status = 'PUBLISHED' AND l.under_review = false AND a.status = 'ACTIVE' AND l.pickup_end > now()`;

@Injectable()
export class ListingSearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * LIST-1. Radius = bounding box (index-friendly) + haversine in SQL. The buyer's coordinates
   * live only in this request: never stored, and logged rounded (CLAUDE.md §7).
   */
  async search(query: SearchListingsQuery): Promise<{ data: ListingCard[] | MapPin[]; page?: PageInfo }> {
    const lat = query.lat ?? DEFAULT_CENTER.lat;
    const lng = query.lng ?? DEFAULT_CENTER.lng;
    if ((query.lat === undefined) !== (query.lng === undefined)) {
      throw new AppException('VALIDATION_FAILED', { fields: { [query.lat === undefined ? 'lat' : 'lng']: 'lat and lng go together' } });
    }
    const radiusM = (query.radiusKm ?? DEFAULT_RADIUS_KM) * 1000;
    const dLat = radiusM / 111_320;
    const dLng = radiusM / (111_320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));

    const distance = Prisma.sql`(2 * ${EARTH_M}::float8 * asin(sqrt(
      power(sin(radians(l.pickup_lat - ${lat}::float8) / 2), 2) +
      cos(radians(${lat}::float8)) * cos(radians(l.pickup_lat)) *
      power(sin(radians(l.pickup_lng - ${lng}::float8) / 2), 2))))`;

    const where: Prisma.Sql[] = [
      VISIBLE_SQL,
      Prisma.sql`l.pickup_lat BETWEEN ${lat - dLat}::float8 AND ${lat + dLat}::float8`,
      Prisma.sql`l.pickup_lng BETWEEN ${lng - dLng}::float8 AND ${lng + dLng}::float8`,
      Prisma.sql`${distance} <= ${radiusM}::float8`,
    ];
    if (!query.includeSoldOut) where.push(Prisma.sql`l.quantity_available > 0`);
    if (query.q?.trim()) {
      const like = `%${query.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(Prisma.sql`(l.title ILIKE ${like} OR a.seller_name ILIKE ${like} OR a.display_name ILIKE ${like})`);
    }
    const categories = this.parseCategories(query.category);
    if (categories) where.push(Prisma.sql`l.category::text IN (${Prisma.join(categories)})`);
    if (query.priceMax !== undefined) where.push(Prisma.sql`l.price <= ${query.priceMax}::int`);
    if (query.free === true) where.push(Prisma.sql`l.price = 0`);
    if (query.free === false) where.push(Prisma.sql`l.price > 0`);
    if (query.sellerId) where.push(Prisma.sql`l.seller_id = ${query.sellerId}::uuid`);
    where.push(...this.pickupTimeFilters(query));

    const order = {
      distance: Prisma.sql`dist ASC`,
      pickupSoon: Prisma.sql`l.pickup_start ASC`,
      priceAsc: Prisma.sql`l.price ASC`,
      newest: Prisma.sql`l.published_at DESC`,
    }[query.sort ?? 'distance'];

    const isMap = query.view === 'map';
    const limit = isMap ? MAP_LIMIT : (query.limit ?? DEFAULT_LIMIT);
    const offset = isMap ? 0 : decodeCursor(query.cursor);
    const hits = await this.prisma.$queryRaw<{ id: string; dist: number }[]>`
      SELECT l.id, ${distance} AS dist
        FROM food_listings l JOIN accounts a ON a.id = l.seller_id
       WHERE ${Prisma.join(where, ' AND ')}
       ORDER BY ${order}, l.id ASC
       LIMIT ${isMap ? limit : limit + 1} OFFSET ${offset}`;

    const rows = await this.prisma.foodListing.findMany({ where: { id: { in: hits.map((h) => h.id) } }, include: LISTING_INCLUDE });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = hits.filter((h) => byId.has(h.id));

    if (isMap) return { data: ordered.map((h) => toMapPin(byId.get(h.id)!)) };
    const { items, page } = paginate(ordered, offset, limit);
    return { data: items.map((h) => toCard(byId.get(h.id)!, h.dist)), page };
  }

  private parseCategories(csv: string | undefined): Category[] | null {
    if (!csv) return null;
    const values = csv.split(',').map((c) => c.trim()).filter(Boolean);
    const bad = values.filter((v) => !(CATEGORIES as readonly string[]).includes(v));
    if (bad.length > 0) throw new AppException('VALIDATION_FAILED', { fields: { category: `unknown: ${bad.join(', ')}` } });
    return values.length > 0 ? (values as Category[]) : null;
  }

  /** pickupDay (today/tomorrow, local) and pickupFrom/pickupTo: the window must overlap. */
  private pickupTimeFilters(query: SearchListingsQuery): Prisma.Sql[] {
    const now = new Date();
    const dayOffset = query.pickupDay === 'tomorrow' ? 1 : 0;
    const filters: Prisma.Sql[] = [];
    if (query.pickupDay) {
      const from = localWallTime(now, 0, 0, dayOffset);
      const to = localWallTime(now, 0, 0, dayOffset + 1);
      filters.push(Prisma.sql`l.pickup_start < ${to} AND l.pickup_end > ${from}`);
    }
    if (query.pickupFrom || query.pickupTo) {
      const [fh, fm] = (query.pickupFrom ?? '00:00').split(':').map(Number);
      const [th, tm] = (query.pickupTo ?? '23:59').split(':').map(Number);
      const from = localWallTime(now, fh!, fm!, dayOffset);
      const to = localWallTime(now, th!, tm!, dayOffset);
      if (to.getTime() <= from.getTime()) {
        throw new AppException('VALIDATION_FAILED', { fields: { pickupTo: 'must be after pickupFrom' } });
      }
      filters.push(Prisma.sql`l.pickup_start < ${to} AND l.pickup_end > ${from}`);
    }
    return filters;
  }
}
