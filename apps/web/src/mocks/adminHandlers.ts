import type {
  AdminAccount,
  AdminMetrics,
  AdminReport,
  ReportAction,
} from "@/lib/api/adminEndpoints";

const REPORT_ACTIONS: readonly ReportAction[] = ["NONE", "WARNING", "LISTING_BLOCKED", "ACCOUNT_SUSPENDED"];
import type {
  AccountStatus,
  ChecklistKey,
  ListingOwnerView,
  ReportType,
  Reservation,
  SellerSummary,
} from "@/lib/contract/types";
import type { Db, DbAccount, DbListing, DbReservation } from "./db";
import { mockConfig, mockOrigin } from "./fixtures";
import { seedDemoReports, type DbReport } from "./reportsStore";

export { seedDemoReports as seedAdminDemoReports, type DbReport };

type AdminDbListing = DbListing & { blockedReason?: string | null };
type AdminDbAccount = DbAccount & { suspendedReason?: string | null; sellerVerificationNote?: string | null };

export type AdminMockDb = Db & {
  reports?: DbReport[];
};

export type AdminMockContext = {
  method: string;
  /** Path without the `/api/v1` prefix, e.g. `/admin/metrics`. */
  path: string;
  url: URL;
  body: unknown;
  headers: Record<string, string>;
  now: Date;
  db: AdminMockDb;
  /** Optional external reports list (e.g. shared with trustHandlers); defaults to `db.reports`. */
  reports?: DbReport[];
};

export type AdminMockResponse = {
  status: number;
  body?: unknown;
};

const MINUTE = 60_000;
const PUBLISHED_EDITABLE = ["title", "description", "imageIds", "quantityTotal", "price", "pickupEnd"];
const UPDATABLE_REPORT_STATUSES: readonly ("IN_REVIEW" | "RESOLVED" | "DISMISSED")[] = [
  "IN_REVIEW",
  "RESOLVED",
  "DISMISSED",
];

function err(status: number, code: string, message: string, details?: Record<string, unknown>): AdminMockResponse {
  return {
    status,
    body: { error: { code, message, ...(details ? { details } : {}), requestId: `mock_${Date.now()}` } },
  };
}

function ok(body: unknown, status = 200): AdminMockResponse {
  return { status, body };
}

function bodyOf<T>(raw: unknown): Partial<T> {
  return (raw && typeof raw === "object" ? raw : {}) as Partial<T>;
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function parseBoundary(raw: string | null, bound: "start" | "end"): number | null | "invalid" {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const suffix = bound === "start" ? "T00:00:00.000+07:00" : "T23:59:59.999+07:00";
    const ms = Date.parse(`${trimmed}${suffix}`);
    return Number.isNaN(ms) ? "invalid" : ms;
  }
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? "invalid" : ms;
}

function inDateRange(iso: string | null | undefined, fromMs: number | null, toMs: number | null): boolean {
  if (fromMs === null && toMs === null) return true;
  if (!iso) return false;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return false;
  if (fromMs !== null && ms < fromMs) return false;
  if (toMs !== null && ms > toMs) return false;
  return true;
}

function paginate<T>(rows: T[], url: URL): { items: T[]; page: { nextCursor: string | null; limit: number } } {
  const rawLimit = Number(url.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 50) : 20;
  const rawOffset = Number(url.searchParams.get("cursor") ?? 0);
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : 0;
  const items = rows.slice(offset, offset + limit);
  const nextCursor = offset + limit < rows.length ? String(offset + limit) : null;
  return { items, page: { nextCursor, limit } };
}

function requireAdmin(ctx: AdminMockContext): { admin: DbAccount } | { error: AdminMockResponse } {
  const auth = ctx.headers.authorization ?? ctx.headers.Authorization ?? "";
  const match = /^Bearer mock-at\.([^.]+)\./.exec(auth);
  const acc = match ? ctx.db.accounts.find((a) => a.id === match[1]) : undefined;
  if (!acc) return { error: err(401, "UNAUTHENTICATED", "Vui lòng đăng nhập.") };
  if (acc.status !== "ACTIVE") return { error: err(403, "ACCOUNT_SUSPENDED", "Tài khoản đang bị tạm khóa.") };
  if (acc.role !== "ADMIN") return { error: err(403, "FORBIDDEN", "Chỉ quản trị viên mới có quyền truy cập.") };
  return { admin: acc };
}

function sellerSummary(a: DbAccount | undefined): SellerSummary {
  if (!a) return { id: "unknown", name: "Người bán", type: null, verified: false };
  return { id: a.id, name: a.seller.name ?? a.displayName ?? "Người bán", type: a.seller.type, verified: a.seller.verified };
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

function toListingOwnerView(db: Db, raw: DbListing, now: Date): ListingOwnerView {
  const l = raw as AdminDbListing;
  const rs = db.reservations.filter((r) => r.listingId === l.id);
  const price = l.price ?? 0;
  const seller = db.accounts.find((a) => a.id === l.sellerId);
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
    distanceMeters: l.pickup ? Math.round(haversineMeters(mockOrigin, l.pickup)) : null,
    seller: sellerSummary(seller),
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
    quantityTotal: l.quantityTotal ?? 0,
    reservedCount: rs.filter((r) => r.status === "RESERVED").reduce((n, r) => n + r.quantity, 0),
    completedCount: rs.filter((r) => r.status === "COMPLETED").reduce((n, r) => n + r.quantity, 0),
    missing: l.status === "DRAFT" ? missingChecklist(l, now) : [],
    editableFields: l.status === "DRAFT" ? ["*"] : l.status === "PUBLISHED" ? PUBLISHED_EDITABLE : [],
    closeReason: l.closeReason,
    blockedReason: l.blockedReason ?? (l.status === "BLOCKED" ? l.closeReason : null),
    createdAt: l.createdAt,
    publishedAt: l.publishedAt,
  };
}

/** Admin view of a reservation: buyer displayName only (no phone/email), NEVER pickupToken (ADM-8). */
function toAdminReservation(db: Db, r: DbReservation): Reservation {
  const l = db.listings.find((x) => x.id === r.listingId);
  const seller = db.accounts.find((a) => a.id === r.sellerId);
  const buyer = db.accounts.find((a) => a.id === r.buyerId);
  return {
    id: r.id,
    code: `SM–${r.code}`,
    status: r.status,
    quantity: r.quantity,
    unitPrice: r.unitPrice,
    totalPrice: r.unitPrice * r.quantity,
    listing: {
      id: l?.id ?? r.listingId,
      title: l?.title ?? "(Tin đã xóa)",
      image: l ? imageOf(db, l.imageIds[0]) : null,
      pickupStart: l?.pickupStart ?? "",
      pickupEnd: l?.pickupEnd ?? "",
      pickup: l?.pickup ?? { address: "", lat: 0, lng: 0 },
      status: l?.status ?? "EXPIRED",
    },
    seller: sellerSummary(seller),
    buyer: { displayName: buyer?.displayName ?? "Người mua" },
    pickupToken: null,
    cancelReason: r.cancelReason,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    closedAt: r.closedAt,
    canCancel: false,
    canReport: false,
  };
}

function toAdminAccount(a: DbAccount): AdminAccount {
  return {
    id: a.id,
    displayName: a.displayName,
    phone: a.phone,
    email: a.email,
    status: a.status,
    seller: a.seller,
    createdAt: a.createdAt,
  };
}

function toAdminReport(db: Db, r: DbReport): AdminReport {
  const reporter = db.accounts.find((a) => a.id === r.reporterId);
  return {
    id: r.id,
    type: r.type,
    description: r.description,
    images: r.imageIds.map((id) => imageOf(db, id)).filter((x): x is NonNullable<typeof x> => x !== null),
    listingId: r.listingId,
    reservationId: r.reservationId,
    reportedAccountId: r.reportedAccountId,
    status: r.status,
    action: r.action,
    resolution: r.resolution,
    createdAt: r.createdAt,
    handledAt: r.handledAt,
    reporter: reporter ? { id: reporter.id, displayName: reporter.displayName ?? "Người dùng" } : null,
  };
}

function revokeTokensForReservation(db: Db, reservationId: string, nowIso: string): void {
  for (const tk of db.tokens) {
    if (tk.reservationId === reservationId && !tk.usedAt && !tk.revokedAt) {
      tk.revokedAt = nowIso;
    }
  }
}

/** Shared transition for ADM-3 and ADM-2 (action = LISTING_BLOCKED). */
function applyBlockListing(db: Db, raw: DbListing, reason: string, now: Date): AdminMockResponse | null {
  if (raw.status !== "PUBLISHED" && raw.status !== "EXPIRED") {
    return err(409, "INVALID_STATE_TRANSITION", "Chỉ có thể khóa tin đang hiển thị hoặc đã hết hạn.", {
      from: raw.status,
      action: "block",
    });
  }
  const l = raw as AdminDbListing;
  const nowIso = now.toISOString();
  l.status = "BLOCKED";
  l.underReview = false;
  l.closedAt = nowIso;
  l.closeReason = reason;
  l.blockedReason = reason;
  for (const r of db.reservations) {
    if (r.listingId === l.id && r.status === "RESERVED") {
      r.status = "CANCELLED";
      r.cancelReason = "LISTING_BLOCKED";
      r.closedAt = nowIso;
      revokeTokensForReservation(db, r.id, nowIso);
    }
  }
  return null;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return round(m, 1);
}

/**
 * Handles docs/API_CONTRACT.md §9 (`ADM-1..9`) mock requests.
 * Returns `null` if the route is not an admin endpoint.
 */
export function handleAdminMock(ctx: AdminMockContext): AdminMockResponse | null {
  if (!ctx.path.startsWith("/admin/")) return null;

  const auth = requireAdmin(ctx);
  if ("error" in auth) return auth.error;
  const { admin } = auth;
  const { db, method, path, url, now } = ctx;
  const reports = ctx.reports ?? (db.reports ??= []);

  // ADM-1 · GET /admin/reports
  if (method === "GET" && path === "/admin/reports") {
    const statusParam = url.searchParams.get("status");
    const typeParam = url.searchParams.get("type");
    const statuses = statusParam ? statusParam.split(",").filter(Boolean) : [];
    const types = typeParam ? typeParam.split(",").filter(Boolean) : [];
    const rows = reports
      .filter((r) => statuses.length === 0 || statuses.includes(r.status))
      .filter((r) => types.length === 0 || types.includes(r.type))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const { items, page } = paginate(rows, url);
    return ok({ data: items.map((r) => toAdminReport(db, r)), page });
  }

  // ADM-2 · PATCH /admin/reports/{reportId}
  const reportMatch = method === "PATCH" ? /^\/admin\/reports\/([^/]+)$/.exec(path) : null;
  if (reportMatch) {
    const reportId = decodeURIComponent(reportMatch[1]!);
    const report = reports.find((r) => r.id === reportId);
    if (!report) return err(404, "REPORT_NOT_FOUND", "Không tìm thấy báo cáo này.");

    const b = bodyOf<{
      status: "IN_REVIEW" | "RESOLVED" | "DISMISSED";
      action: ReportAction;
      resolution: string | null;
      clearReview: boolean;
    }>(ctx.body);

    if (!b.status || !UPDATABLE_REPORT_STATUSES.includes(b.status)) {
      return err(400, "VALIDATION_FAILED", "Trạng thái xử lý không hợp lệ.", { fields: { status: "invalid" } });
    }
    if (b.action !== undefined && !REPORT_ACTIONS.includes(b.action)) {
      return err(400, "VALIDATION_FAILED", "Hành động xử lý không hợp lệ.", { fields: { action: "invalid" } });
    }

    const action: ReportAction = b.action ?? "NONE";
    const resolution = typeof b.resolution === "string" ? b.resolution.trim() || null : null;

    if (action === "LISTING_BLOCKED" && report.listingId) {
      const listing = db.listings.find((l) => l.id === report.listingId);
      if (listing && (listing.status === "PUBLISHED" || listing.status === "EXPIRED")) {
        applyBlockListing(db, listing, resolution ?? "Khóa theo xử lý báo cáo vi phạm", now);
      }
    }

    if (action === "ACCOUNT_SUSPENDED" && report.reportedAccountId) {
      const reportedAcc = db.accounts.find((a) => a.id === report.reportedAccountId) as AdminDbAccount | undefined;
      if (reportedAcc && reportedAcc.id !== admin.id) {
        reportedAcc.status = "SUSPENDED";
        reportedAcc.suspendedReason = resolution ?? "Tạm khóa theo xử lý báo cáo vi phạm";
      }
    }

    if (b.clearReview && report.listingId) {
      const listing = db.listings.find((l) => l.id === report.listingId);
      if (listing) listing.underReview = false;
    }

    report.status = b.status;
    report.action = action;
    report.resolution = resolution;
    report.handledBy = admin.id;
    if (b.status === "RESOLVED" || b.status === "DISMISSED") {
      report.handledAt = now.toISOString();
    }

    return ok({ data: toAdminReport(db, report) });
  }

  // ADM-3 · POST /admin/listings/{listingId}/block
  const blockMatch = method === "POST" ? /^\/admin\/listings\/([^/]+)\/block$/.exec(path) : null;
  if (blockMatch) {
    const listingId = decodeURIComponent(blockMatch[1]!);
    const listing = db.listings.find((l) => l.id === listingId);
    if (!listing) return err(404, "LISTING_NOT_FOUND", "Không tìm thấy món này.");
    const b = bodyOf<{ reason: string }>(ctx.body);
    const reason = typeof b.reason === "string" ? b.reason.trim() : "";
    if (!reason) {
      return err(400, "VALIDATION_FAILED", "Vui lòng nhập lý do khóa tin.", { fields: { reason: "required" } });
    }
    const blockErr = applyBlockListing(db, listing, reason, now);
    if (blockErr) return blockErr;
    return ok({ data: toListingOwnerView(db, listing, now) });
  }

  // ADM-4 · POST /admin/accounts/{accountId}/status
  const statusMatch = method === "POST" ? /^\/admin\/accounts\/([^/]+)\/status$/.exec(path) : null;
  if (statusMatch) {
    const accountId = decodeURIComponent(statusMatch[1]!);
    const acc = db.accounts.find((a) => a.id === accountId) as AdminDbAccount | undefined;
    if (!acc) return err(404, "ACCOUNT_NOT_FOUND", "Không tìm thấy tài khoản này.");
    const b = bodyOf<{ status: AccountStatus; reason: string }>(ctx.body);
    if (b.status !== "ACTIVE" && b.status !== "SUSPENDED") {
      return err(400, "VALIDATION_FAILED", "Trạng thái tài khoản không hợp lệ.", { fields: { status: "invalid" } });
    }
    const reason = typeof b.reason === "string" ? b.reason.trim() : "";
    if (!reason) {
      return err(400, "VALIDATION_FAILED", "Vui lòng nhập lý do thay đổi trạng thái.", { fields: { reason: "required" } });
    }
    if (acc.id === admin.id && b.status === "SUSPENDED") {
      return err(409, "INVALID_STATE_TRANSITION", "Không thể tự tạm khóa tài khoản quản trị đang dùng.", {
        from: acc.status,
        action: "suspend",
      });
    }
    acc.status = b.status;
    acc.suspendedReason = b.status === "SUSPENDED" ? reason : null;
    return ok({ data: { id: acc.id, status: acc.status } });
  }

  // ADM-5 · POST /admin/accounts/{accountId}/seller-verification
  const verifyMatch = method === "POST" ? /^\/admin\/accounts\/([^/]+)\/seller-verification$/.exec(path) : null;
  if (verifyMatch) {
    const accountId = decodeURIComponent(verifyMatch[1]!);
    const acc = db.accounts.find((a) => a.id === accountId) as AdminDbAccount | undefined;
    if (!acc) return err(404, "ACCOUNT_NOT_FOUND", "Không tìm thấy tài khoản này.");
    const b = bodyOf<{ verified: boolean; note?: string | null }>(ctx.body);
    if (typeof b.verified !== "boolean") {
      return err(400, "VALIDATION_FAILED", "Thiếu trạng thái xác minh.", { fields: { verified: "boolean" } });
    }
    acc.seller.verified = b.verified;
    acc.sellerVerificationNote = typeof b.note === "string" ? b.note.trim() || null : null;
    return ok({ data: { id: acc.id, seller: acc.seller } });
  }

  // ADM-6 · GET /admin/accounts
  if (method === "GET" && path === "/admin/accounts") {
    const q = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase("vi");
    const statusParam = url.searchParams.get("status");
    const sellerOnly = url.searchParams.get("sellerOnly") === "true";
    const sellerIdsWithListings = new Set(db.listings.map((l) => l.sellerId));

    const rows = db.accounts
      .filter((a) => !statusParam || a.status === statusParam)
      .filter((a) => {
        if (!sellerOnly) return true;
        return Boolean(a.seller.name || a.seller.type || a.seller.verified || sellerIdsWithListings.has(a.id));
      })
      .filter((a) => {
        if (!q) return true;
        const fields = [a.displayName, a.phone, a.email, a.seller.name].filter(Boolean).map((s) => s!.toLocaleLowerCase("vi"));
        return fields.some((f) => f.includes(q));
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const { items, page } = paginate(rows, url);
    return ok({ data: items.map(toAdminAccount), page });
  }

  // ADM-7 · GET /admin/listings
  if (method === "GET" && path === "/admin/listings") {
    const fromMs = parseBoundary(url.searchParams.get("from"), "start");
    const toMs = parseBoundary(url.searchParams.get("to"), "end");
    if (fromMs === "invalid" || toMs === "invalid") {
      return err(400, "VALIDATION_FAILED", "Khoảng thời gian không hợp lệ.", { fields: { from: "date", to: "date" } });
    }
    const statusParam = url.searchParams.get("status");
    const statuses = statusParam ? statusParam.split(",").filter(Boolean) : [];
    const underReviewParam = url.searchParams.get("underReview");
    const sellerId = url.searchParams.get("sellerId");

    const rows = db.listings
      .filter((l) => statuses.length === 0 || statuses.includes(l.status))
      .filter((l) => underReviewParam === null || l.underReview === (underReviewParam === "true"))
      .filter((l) => !sellerId || l.sellerId === sellerId)
      .filter((l) => inDateRange(l.publishedAt ?? l.createdAt, fromMs, toMs))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const { items, page } = paginate(rows, url);
    return ok({ data: items.map((l) => toListingOwnerView(db, l, now)), page });
  }

  // ADM-8 · GET /admin/reservations
  if (method === "GET" && path === "/admin/reservations") {
    const fromMs = parseBoundary(url.searchParams.get("from"), "start");
    const toMs = parseBoundary(url.searchParams.get("to"), "end");
    if (fromMs === "invalid" || toMs === "invalid") {
      return err(400, "VALIDATION_FAILED", "Khoảng thời gian không hợp lệ.", { fields: { from: "date", to: "date" } });
    }
    const statusParam = url.searchParams.get("status");
    const statuses = statusParam ? statusParam.split(",").filter(Boolean) : [];
    const sellerId = url.searchParams.get("sellerId");

    const rows = db.reservations
      .filter((r) => statuses.length === 0 || statuses.includes(r.status))
      .filter((r) => !sellerId || r.sellerId === sellerId)
      .filter((r) => inDateRange(r.createdAt, fromMs, toMs))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const { items, page } = paginate(rows, url);
    return ok({ data: items.map((r) => toAdminReservation(db, r)), page });
  }

  // ADM-9 · GET /admin/metrics (DOMAIN §8 KPIs)
  if (method === "GET" && path === "/admin/metrics") {
    const fromMs = parseBoundary(url.searchParams.get("from"), "start");
    const toMs = parseBoundary(url.searchParams.get("to"), "end");
    if (fromMs === "invalid" || toMs === "invalid") {
      return err(400, "VALIDATION_FAILED", "Khoảng thời gian không hợp lệ.", { fields: { from: "date", to: "date" } });
    }
    const sellerId = url.searchParams.get("sellerId");

    const matchedReservations = db.reservations
      .filter((r) => !sellerId || r.sellerId === sellerId)
      .filter((r) => inDateRange(r.createdAt, fromMs, toMs));

    const completedReservations = matchedReservations.filter((r) => r.status === "COMPLETED");
    const cancelledReservations = matchedReservations.filter((r) => r.status === "CANCELLED");
    const expiredReservations = matchedReservations.filter((r) => r.status === "EXPIRED");

    const portionsHandedOver = completedReservations.reduce((sum, r) => sum + r.quantity, 0);
    const createdCount = matchedReservations.length;
    const completionRate = createdCount > 0 ? round(completedReservations.length / createdCount) : 0;

    const matchedListings = db.listings
      .filter((l) => l.publishedAt !== null || l.status !== "DRAFT")
      .filter((l) => !sellerId || l.sellerId === sellerId)
      .filter((l) => inDateRange(l.publishedAt ?? l.createdAt, fromMs, toMs));

    const publishedCount = matchedListings.length;
    const expiredWithStock = matchedListings.filter((l) => l.status === "EXPIRED" && l.quantityAvailable > 0).length;
    const listingExpiredRate = publishedCount > 0 ? round(expiredWithStock / publishedCount) : 0;

    let discountRateSum = 0;
    let discountSamples = 0;
    for (const r of completedReservations) {
      const listing = db.listings.find((l) => l.id === r.listingId);
      if (listing?.originalPrice !== null && listing?.originalPrice !== undefined && listing.originalPrice > 0) {
        discountRateSum += (listing.originalPrice - r.unitPrice) / listing.originalPrice;
        discountSamples += 1;
      }
    }

    const matchedReports = reports
      .filter((r) => {
        if (!sellerId) return true;
        if (r.reportedAccountId === sellerId) return true;
        const listing = r.listingId ? db.listings.find((l) => l.id === r.listingId) : undefined;
        return listing?.sellerId === sellerId;
      })
      .filter((r) => inDateRange(r.createdAt, fromMs, toMs));

    const byType: Partial<Record<ReportType, number>> = {};
    const byAction: Partial<Record<ReportAction, number>> = {};
    const handlingHours: number[] = [];
    let openCount = 0;

    for (const r of matchedReports) {
      byType[r.type] = (byType[r.type] ?? 0) + 1;
      if (r.status === "OPEN" || r.status === "IN_REVIEW") {
        openCount += 1;
      }
      if (r.action) {
        byAction[r.action] = (byAction[r.action] ?? 0) + 1;
      }
      if (r.handledAt) {
        const diffHours = Math.max(0, (Date.parse(r.handledAt) - Date.parse(r.createdAt)) / 3_600_000);
        handlingHours.push(diffHours);
      }
    }

    const metrics: AdminMetrics = {
      portionsHandedOver,
      reservations: {
        created: createdCount,
        completed: completedReservations.length,
        cancelled: cancelledReservations.length,
        expired: expiredReservations.length,
      },
      completionRate,
      listings: {
        published: publishedCount,
        expiredWithStock,
      },
      listingExpiredRate,
      discount: {
        avgRate: discountSamples > 0 ? round(discountRateSum / discountSamples) : 0,
        samples: discountSamples,
      },
      reports: {
        total: matchedReports.length,
        byType,
        open: openCount,
        medianHandlingHours: median(handlingHours),
        byAction,
      },
    };

    return ok({ data: metrics });
  }

  return null;
}
