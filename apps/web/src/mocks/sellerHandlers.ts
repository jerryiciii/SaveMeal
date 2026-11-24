import type { WithdrawReason } from "@/lib/api/sellerEndpoints";

const WITHDRAW_REASONS: readonly WithdrawReason[] = ["STORAGE_NOT_OK", "SOLD_ELSEWHERE", "OTHER"];
import type {
  ChecklistKey,
  ListingCard,
  ListingDetail,
  ListingOwnerView,
  SellerProfile,
  SellerSummary,
} from "@/lib/contract/types";
import type { Db, DbAccount, DbListing } from "./db";
import { mockConfig, mockOrigin } from "./fixtures";

export type SellerMockContext = {
  method: string;
  path: string;
  url: URL;
  body: unknown;
  headers: Record<string, string>;
  now: Date;
  db: Db;
};

export type SellerMockResult = {
  status: number;
  body?: unknown;
};

const MINUTE = 60_000;
const PUBLISHED_EDITABLE = ["title", "description", "imageIds", "quantityTotal", "price", "pickupEnd"] as const;

type ListingInputBody = Partial<{
  title: string;
  description: string | null;
  category: DbListing["category"];
  imageIds: string[];
  origin: string;
  preparedAt: string;
  storage: DbListing["storage"];
  storageNote: string | null;
  ingredients: string | null;
  allergens: DbListing["allergens"];
  originalPrice: number | null;
  price: number;
  quantityTotal: number;
  pickupStart: string;
  pickupEnd: string;
  pickup: DbListing["pickup"];
}>;

class MockHandlerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function fail(status: number, code: string, message: string, details?: Record<string, unknown>): never {
  throw new MockHandlerError(status, code, message, details);
}

function bodyOf<T>(raw: unknown): Partial<T> {
  return (raw && typeof raw === "object" ? raw : {}) as Partial<T>;
}

function requireUser(ctx: SellerMockContext): DbAccount {
  const auth = ctx.headers.authorization ?? ctx.headers.Authorization ?? "";
  const m = /^Bearer mock-at\.([^.]+)\./.exec(auth);
  const acc = m ? ctx.db.accounts.find((a) => a.id === m[1]) : undefined;
  if (!acc) fail(401, "UNAUTHENTICATED", "Vui lòng đăng nhập.");
  if (acc.status !== "ACTIVE") fail(403, "ACCOUNT_SUSPENDED", "Tài khoản đang bị tạm khóa.");
  return acc;
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function sellerSummary(a: DbAccount): SellerSummary {
  return {
    id: a.id,
    name: a.seller.name ?? a.displayName ?? "Người bán",
    type: a.seller.type,
    verified: a.seller.verified,
  };
}

function imageOf(db: Db, id: string | undefined) {
  const img = id ? db.images.find((i) => i.id === id) : undefined;
  return img ? { id: img.id, url: img.url, width: img.width, height: img.height } : null;
}

function missingChecklist(l: DbListing, now: Date): ChecklistKey[] {
  const m: ChecklistKey[] = [];
  if (l.imageIds.length < 1) m.push("PHOTO");
  if (!l.title || l.title.trim().length < 3 || l.title.length > 80) m.push("NAME");
  if (l.price === null || l.price < 0 || (l.originalPrice !== null && l.price > l.originalPrice)) m.push("PRICE");
  if (!l.quantityTotal || l.quantityTotal < 1 || l.quantityTotal > 50) m.push("PORTIONS");
  if (!l.origin?.trim()) m.push("ORIGIN");
  if (!l.preparedAt || Date.parse(l.preparedAt) > now.getTime()) m.push("PREPARED_AT");
  if (!l.storage) m.push("STORAGE");
  const s = l.pickupStart ? Date.parse(l.pickupStart) : NaN;
  const e = l.pickupEnd ? Date.parse(l.pickupEnd) : NaN;
  if (!(s < e) || e <= now.getTime() || e - s > mockConfig.limits.maxWindowHours * 60 * MINUTE) m.push("PICKUP_WINDOW");
  if (!l.pickup?.address || !Number.isFinite(l.pickup.lat) || !Number.isFinite(l.pickup.lng)) m.push("PICKUP_LOCATION");
  return m;
}

function toCard(db: Db, l: DbListing, distanceMeters: number | null): ListingCard {
  const sellerAcc = db.accounts.find((a) => a.id === l.sellerId)!;
  const price = l.price ?? 0;
  return {
    id: l.id,
    title: l.title ?? "",
    category: l.category,
    image: imageOf(db, l.imageIds[0]),
    originalPrice: l.originalPrice,
    price,
    isFree: price === 0,
    quantityAvailable: l.quantityAvailable,
    soldOut: l.quantityAvailable === 0,
    pickupStart: l.pickupStart ?? "",
    pickupEnd: l.pickupEnd ?? "",
    pickup: l.pickup ?? { address: "", lat: 0, lng: 0 },
    distanceMeters,
    seller: sellerSummary(sellerAcc),
  };
}

function toDetail(db: Db, l: DbListing): ListingDetail {
  return {
    ...toCard(db, l, l.pickup ? Math.round(haversineMeters(mockOrigin, l.pickup)) : null),
    description: l.description,
    images: l.imageIds.map((id) => imageOf(db, id)).filter((x): x is NonNullable<typeof x> => x !== null),
    origin: l.origin ?? "",
    preparedAt: l.preparedAt ?? "",
    storage: l.storage ?? "ROOM_TEMP",
    storageNote: l.storageNote,
    ingredients: l.ingredients,
    allergens: l.allergens,
    status: l.status,
    underReview: l.underReview,
    declaredAt: l.declaredAt,
    myActiveReservationId: null,
  };
}

function toOwner(db: Db, l: DbListing, now: Date): ListingOwnerView {
  const rs = db.reservations.filter((r) => r.listingId === l.id);
  return {
    ...toDetail(db, l),
    quantityTotal: l.quantityTotal ?? 0,
    reservedCount: rs.filter((r) => r.status === "RESERVED").reduce((n, r) => n + r.quantity, 0),
    completedCount: rs.filter((r) => r.status === "COMPLETED").reduce((n, r) => n + r.quantity, 0),
    missing: l.status === "DRAFT" ? missingChecklist(l, now) : [],
    editableFields: l.status === "DRAFT" ? ["*"] : l.status === "PUBLISHED" ? [...PUBLISHED_EDITABLE] : [],
    closeReason: l.closeReason,
    blockedReason: null,
    createdAt: l.createdAt,
    publishedAt: l.publishedAt,
  };
}

function revokeTokens(db: Db, reservationId: string, now: Date): void {
  const iso = now.toISOString();
  for (const tk of db.tokens) {
    if (tk.reservationId === reservationId && !tk.usedAt && !tk.revokedAt) {
      tk.revokedAt = iso;
    }
  }
}

function applyInput(l: DbListing, b: ListingInputBody): void {
  const keys = Object.keys(b) as (keyof ListingInputBody)[];
  for (const k of keys) {
    const v = b[k];
    if (v === undefined) continue;
    (l as Record<string, unknown>)[k] = v;
  }
}

function handleGetSeller(ctx: SellerMockContext, accountId: string): SellerMockResult {
  const acc = ctx.db.accounts.find((a) => a.id === accountId);
  if (!acc || acc.status !== "ACTIVE") {
    fail(404, "SELLER_NOT_FOUND", "Không tìm thấy người bán này.");
  }
  const nowMs = ctx.now.getTime();
  const activeListingCount = ctx.db.listings.filter(
    (l) =>
      l.sellerId === acc.id &&
      l.status === "PUBLISHED" &&
      !l.underReview &&
      l.quantityAvailable > 0 &&
      (!l.pickupEnd || Date.parse(l.pickupEnd) > nowMs),
  ).length;
  const completedHandovers = ctx.db.reservations.filter(
    (r) => r.sellerId === acc.id && r.status === "COMPLETED",
  ).length;

  const profile: SellerProfile = {
    ...sellerSummary(acc),
    activeListingCount,
    completedHandovers,
    memberSince: acc.createdAt,
  };
  return { status: 200, body: { data: profile } };
}

function handleDeleteListing(ctx: SellerMockContext, listingId: string): SellerMockResult {
  const acc = requireUser(ctx);
  const idx = ctx.db.listings.findIndex((l) => l.id === listingId);
  const listing = idx >= 0 ? ctx.db.listings[idx] : undefined;
  if (!listing || listing.sellerId !== acc.id) {
    fail(404, "LISTING_NOT_FOUND", "Không tìm thấy món này.");
  }
  if (listing.status !== "DRAFT") {
    fail(409, "INVALID_STATE_TRANSITION", "Chỉ có thể xóa bản nháp. Hãy gỡ tin nếu tin đã đăng.", {
      from: listing.status,
      action: "delete",
    });
  }
  ctx.db.listings.splice(idx, 1);
  return { status: 204 };
}

function handleWithdrawListing(ctx: SellerMockContext, listingId: string): SellerMockResult {
  const acc = requireUser(ctx);
  const listing = ctx.db.listings.find((l) => l.id === listingId);
  if (!listing || listing.sellerId !== acc.id) {
    fail(404, "LISTING_NOT_FOUND", "Không tìm thấy món này.");
  }
  if (listing.status !== "DRAFT" && listing.status !== "PUBLISHED") {
    fail(409, "INVALID_STATE_TRANSITION", "Tin này đã đóng.", {
      from: listing.status,
      action: "withdraw",
    });
  }
  const b = bodyOf<{ reason?: string; note?: string | null }>(ctx.body);
  if (!b.reason || !WITHDRAW_REASONS.includes(b.reason as WithdrawReason)) {
    fail(400, "VALIDATION_FAILED", "Vui lòng chọn lý do gỡ tin.", { fields: { reason: "required" } });
  }
  if (b.note !== undefined && b.note !== null && (typeof b.note !== "string" || b.note.length > 200)) {
    fail(400, "VALIDATION_FAILED", "Ghi chú tối đa 200 ký tự.", { fields: { note: "max 200" } });
  }

  const trimmedNote = typeof b.note === "string" ? b.note.trim() : "";
  const nowIso = ctx.now.toISOString();
  listing.status = "WITHDRAWN";
  listing.closedAt = nowIso;
  listing.closeReason = trimmedNote ? `${b.reason}: ${trimmedNote}` : b.reason;

  for (const r of ctx.db.reservations) {
    if (r.listingId === listing.id && r.status === "RESERVED") {
      r.status = "CANCELLED";
      r.cancelReason = "SELLER_WITHDREW";
      r.closedAt = nowIso;
      revokeTokens(ctx.db, r.id, ctx.now);
    }
  }

  return { status: 200, body: { data: toOwner(ctx.db, listing, ctx.now) } };
}

function handleDeleteImage(ctx: SellerMockContext, imageId: string): SellerMockResult {
  const acc = requireUser(ctx);
  const idx = ctx.db.images.findIndex((img) => img.id === imageId);
  const img = idx >= 0 ? ctx.db.images[idx] : undefined;
  if (!img || img.uploaderId !== acc.id) {
    fail(404, "IMAGE_NOT_FOUND", "Không tìm thấy ảnh này.");
  }
  const inPublished = ctx.db.listings.some(
    (l) => l.status === "PUBLISHED" && l.imageIds.includes(img.id),
  );
  if (inPublished) {
    fail(409, "IMAGE_IN_USE", "Ảnh đang được dùng trong tin đang đăng.");
  }
  ctx.db.images.splice(idx, 1);
  for (const l of ctx.db.listings) {
    if (l.status === "DRAFT" && l.imageIds.includes(img.id)) {
      l.imageIds = l.imageIds.filter((id) => id !== img.id);
    }
  }
  return { status: 204 };
}

function handlePatchListing(ctx: SellerMockContext, listingId: string): SellerMockResult {
  const acc = requireUser(ctx);
  const listing = ctx.db.listings.find((l) => l.id === listingId);
  if (!listing || listing.sellerId !== acc.id) {
    fail(404, "LISTING_NOT_FOUND", "Không tìm thấy món này.");
  }
  const b = bodyOf<ListingInputBody>(ctx.body);

  if (listing.status === "PUBLISHED") {
    const providedKeys = Object.entries(b)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
    const locked = providedKeys.filter((k) => !(PUBLISHED_EDITABLE as readonly string[]).includes(k));
    if (locked.length > 0) {
      fail(409, "FIELD_LOCKED", "Không thể sửa thông tin này sau khi đăng. Hãy gỡ tin và đăng mới.", {
        fields: locked,
      });
    }

    if (b.title !== undefined) {
      const trimmed = String(b.title).trim();
      if (trimmed.length < 3 || trimmed.length > 80) {
        fail(400, "VALIDATION_FAILED", "Tên món cần từ 3 đến 80 ký tự.", { fields: { title: "3-80" } });
      }
      b.title = trimmed;
    }

    if (b.description !== undefined && b.description !== null && b.description.length > 500) {
      fail(400, "VALIDATION_FAILED", "Mô tả tối đa 500 ký tự.", { fields: { description: "max 500" } });
    }

    if (b.imageIds !== undefined) {
      if (!Array.isArray(b.imageIds) || b.imageIds.length < 1 || b.imageIds.length > mockConfig.limits.maxImagesPerListing) {
        fail(400, "VALIDATION_FAILED", `Tin đang đăng cần từ 1 đến ${mockConfig.limits.maxImagesPerListing} ảnh.`, {
          fields: { imageIds: "1-4" },
        });
      }
    }

    if (b.quantityTotal !== undefined) {
      if (!Number.isInteger(b.quantityTotal) || b.quantityTotal < 1 || b.quantityTotal > 50) {
        fail(400, "VALIDATION_FAILED", "Số suất phải từ 1 đến 50.", { fields: { quantityTotal: "1-50" } });
      }
      const allocated = (listing.quantityTotal ?? 0) - listing.quantityAvailable;
      if (b.quantityTotal < allocated) {
        fail(409, "QUANTITY_BELOW_RESERVED", "Số suất không thể nhỏ hơn số suất đã được giữ.");
      }
    }

    if (b.price !== undefined) {
      if (!Number.isInteger(b.price) || b.price < 0) {
        fail(400, "VALIDATION_FAILED", "Giá bán không hợp lệ.", { fields: { price: "min 0" } });
      }
      if (b.price > (listing.price ?? 0)) {
        fail(409, "PRICE_INCREASE_NOT_ALLOWED", "Chỉ có thể giảm giá sau khi đăng.");
      }
    }

    if (b.pickupEnd !== undefined) {
      const nextEnd = Date.parse(b.pickupEnd);
      const currentEnd = Date.parse(listing.pickupEnd ?? "");
      const startMs = Date.parse(listing.pickupStart ?? "");
      if (Number.isNaN(nextEnd)) {
        fail(400, "VALIDATION_FAILED", "Giờ kết thúc nhận không hợp lệ.", { fields: { pickupEnd: "invalid" } });
      }
      if (!Number.isNaN(currentEnd) && nextEnd > currentEnd) {
        fail(409, "PICKUP_WINDOW_EXTENSION_NOT_ALLOWED", "Không thể kéo dài giờ nhận sau khi đăng.");
      }
      if (nextEnd <= ctx.now.getTime() || (!Number.isNaN(startMs) && nextEnd <= startMs)) {
        fail(422, "PICKUP_WINDOW_INVALID", "Giờ kết thúc nhận phải sau hiện tại và sau giờ bắt đầu.");
      }
    }

    if (b.quantityTotal !== undefined) {
      listing.quantityAvailable += b.quantityTotal - (listing.quantityTotal ?? 0);
    }
  } else if (listing.status !== "DRAFT") {
    fail(409, "INVALID_STATE_TRANSITION", "Tin này đã đóng.", {
      from: listing.status,
      action: "update",
    });
  }

  applyInput(listing, b);
  return { status: 200, body: { data: toOwner(ctx.db, listing, ctx.now) } };
}

/**
 * Mock route handler for Seller Profile & Listing Management endpoints:
 * - GET    /sellers/:id           (SELLER-1)
 * - DELETE /listings/:id          (LIST-5)
 * - POST   /listings/:id/withdraw (LIST-7)
 * - DELETE /images/:id            (IMG-2)
 * - PATCH  /listings/:id          (LIST-4 with DOMAIN §3 PUBLISHED guards)
 *
 * Returns `null` when the request path/method is not handled here.
 */
export function handleSellerMock(ctx: SellerMockContext): SellerMockResult | null {
  try {
    let m: RegExpMatchArray | null;

    if (ctx.method === "GET" && (m = ctx.path.match(/^\/sellers\/([^/]+)$/))) {
      return handleGetSeller(ctx, decodeURIComponent(m[1]!));
    }
    if (ctx.method === "DELETE" && (m = ctx.path.match(/^\/listings\/([^/]+)$/))) {
      return handleDeleteListing(ctx, decodeURIComponent(m[1]!));
    }
    if (ctx.method === "POST" && (m = ctx.path.match(/^\/listings\/([^/]+)\/withdraw$/))) {
      return handleWithdrawListing(ctx, decodeURIComponent(m[1]!));
    }
    if (ctx.method === "DELETE" && (m = ctx.path.match(/^\/images\/([^/]+)$/))) {
      return handleDeleteImage(ctx, decodeURIComponent(m[1]!));
    }
    if (ctx.method === "PATCH" && (m = ctx.path.match(/^\/listings\/([^/]+)$/))) {
      return handlePatchListing(ctx, decodeURIComponent(m[1]!));
    }

    return null;
  } catch (err) {
    if (err instanceof MockHandlerError) {
      return {
        status: err.status,
        body: {
          error: {
            code: err.code,
            message: err.message,
            ...(err.details ? { details: err.details } : {}),
            requestId: `mock_${Date.now()}`,
          },
        },
      };
    }
    throw err;
  }
}
