import type {
  CreateReportInput,
  UpdateProfilePatch,
} from "@/lib/api/trustEndpoints";
import { SELLER_TYPES, type Image, type Me, type ReportType, type SellerType } from "@/lib/contract/types";

const DELETE_ACCOUNT_CONFIRM = "XOA TAI KHOAN";
const REPORT_TYPES: readonly ReportType[] = ["WRONG_INFO", "UNSAFE_FOOD", "NOT_RECEIVED", "SELLER_ABSENT", "OTHER"];
import type { Db, DbAccount } from "./db";
import {
  addReport,
  getAccountAvatarImageId,
  getAccountDeletedAt,
  loadReports,
  markAccountDeleted,
  setAccountAvatarImageId,
  toReportView,
  type DbReport,
} from "./reportsStore";

export type TrustMockSession = {
  get(): string | null;
  set(accountId: string | null): void;
};

export type TrustMockContext = {
  method: string;
  path: string;
  url?: URL;
  body: unknown;
  headers: Record<string, string>;
  now: Date;
  db: Db;
  session: TrustMockSession;
};

export type TrustMockResult = {
  status: number;
  body?: unknown;
};

const MAX_REPORTS_PER_DAY = 10;
const RESERVATION_REQUIRED_TYPES: readonly ReportType[] = ["NOT_RECEIVED", "SELLER_ABSENT"];

function errorResult(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): TrustMockResult {
  return {
    status,
    body: {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
        requestId: `mock_${Date.now()}`,
      },
    },
  };
}

function rid(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}${Math.random()}`;
  return `${prefix}-${rand}`;
}

function localDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));
}

function resolveUser(
  ctx: TrustMockContext,
  { allowSuspended = false }: { allowSuspended?: boolean } = {},
): { acc: DbAccount } | { error: TrustMockResult } {
  const auth = ctx.headers.authorization ?? ctx.headers.Authorization ?? "";
  const m = /^Bearer mock-at\.([^.]+)\./.exec(auth);
  const acc = m ? ctx.db.accounts.find((a) => a.id === m[1]) : undefined;
  if (!acc || getAccountDeletedAt(acc)) {
    return { error: errorResult(401, "UNAUTHENTICATED", "Vui lòng đăng nhập.") };
  }
  if (!allowSuspended && acc.status !== "ACTIVE") {
    return { error: errorResult(403, "ACCOUNT_SUSPENDED", "Tài khoản đang bị tạm khóa.") };
  }
  return { acc };
}

function imageOf(db: Db, id: string | null): Image | null {
  if (!id) return null;
  const img = db.images.find((i) => i.id === id);
  return img ? { id: img.id, url: img.url, width: img.width, height: img.height } : null;
}

export function toMeWithAvatar(db: Db, a: DbAccount): Me {
  const myListings = db.listings.filter(
    (l) => l.sellerId === a.id && (l.status === "PUBLISHED" || l.status === "DRAFT"),
  );
  return {
    id: a.id,
    displayName: a.displayName,
    phone: a.phone,
    email: a.email,
    avatar: imageOf(db, getAccountAvatarImageId(a)),
    role: a.role,
    status: a.status,
    seller: a.seller,
    stats: {
      portionsHandedOver: db.reservations
        .filter((r) => r.sellerId === a.id && r.status === "COMPLETED")
        .reduce((n, r) => n + r.quantity, 0),
      reservationsActive: db.reservations.filter(
        (r) => r.buyerId === a.id && r.status === "RESERVED",
      ).length,
      listingsActive: myListings.length,
    },
    createdAt: a.createdAt,
  };
}

function objectBody<T>(raw: unknown): Partial<T> {
  return (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Partial<T>;
}

function handleCreateReport(ctx: TrustMockContext): TrustMockResult {
  const auth = resolveUser(ctx);
  if ("error" in auth) return auth.error;
  const acc = auth.acc;

  const b = objectBody<CreateReportInput>(ctx.body);
  const type = b.type;
  if (!type || !(REPORT_TYPES as readonly string[]).includes(type)) {
    return errorResult(400, "VALIDATION_FAILED", "Loại báo cáo không hợp lệ.", {
      fields: { type: "invalid" },
    });
  }

  const description = typeof b.description === "string" ? b.description.trim() : "";
  if (description.length < 10 || description.length > 1000) {
    return errorResult(400, "VALIDATION_FAILED", "Mô tả vấn đề cần từ 10 đến 1000 ký tự.", {
      fields: { description: "10–1000" },
    });
  }

  const rawImageIds = b.imageIds ?? [];
  if (!Array.isArray(rawImageIds) || rawImageIds.some((id) => typeof id !== "string")) {
    return errorResult(400, "VALIDATION_FAILED", "Danh sách ảnh minh chứng không hợp lệ.", {
      fields: { imageIds: "invalid" },
    });
  }
  if (rawImageIds.length > 4) {
    return errorResult(400, "VALIDATION_FAILED", "Tối đa 4 ảnh minh chứng.", {
      fields: { imageIds: "max 4" },
    });
  }
  for (const imageId of rawImageIds) {
    if (!ctx.db.images.some((i) => i.id === imageId)) {
      return errorResult(404, "IMAGE_NOT_FOUND", "Không tìm thấy ảnh minh chứng.");
    }
  }

  const listingIdInput = typeof b.listingId === "string" && b.listingId.trim() ? b.listingId.trim() : null;
  const reservationIdInput =
    typeof b.reservationId === "string" && b.reservationId.trim() ? b.reservationId.trim() : null;
  const accountIdInput = typeof b.accountId === "string" && b.accountId.trim() ? b.accountId.trim() : null;

  if (!listingIdInput && !reservationIdInput && !accountIdInput) {
    return errorResult(422, "REPORT_TARGET_INVALID", "Cần chọn món ăn, đơn đặt hoặc tài khoản để báo cáo.");
  }

  if (RESERVATION_REQUIRED_TYPES.includes(type) && !reservationIdInput) {
    return errorResult(
      422,
      "REPORT_TARGET_INVALID",
      "Loại báo cáo này yêu cầu gắn với đơn đặt giữ của bạn.",
    );
  }

  let resolvedListingId: string | null = listingIdInput;
  let resolvedReservationId: string | null = reservationIdInput;
  let reportedAccountId: string | null = null;

  if (reservationIdInput) {
    const reservation = ctx.db.reservations.find((r) => r.id === reservationIdInput);
    if (!reservation) {
      return errorResult(422, "REPORT_TARGET_INVALID", "Không tìm thấy đơn đặt giữ để báo cáo.");
    }
    const isBuyer = reservation.buyerId === acc.id;
    const isSeller = reservation.sellerId === acc.id;
    if (!isBuyer && !isSeller) {
      return errorResult(422, "REPORT_TARGET_INVALID", "Bạn chỉ có thể báo cáo đơn đặt giữ của chính mình.");
    }
    if (RESERVATION_REQUIRED_TYPES.includes(type) && !isBuyer) {
      return errorResult(422, "REPORT_TARGET_INVALID", "Chỉ người mua của đơn mới có thể gửi loại báo cáo này.");
    }
    if (listingIdInput && listingIdInput !== reservation.listingId) {
      return errorResult(422, "REPORT_TARGET_INVALID", "Tin đăng không khớp với đơn đặt giữ.");
    }
    resolvedListingId = reservation.listingId;
    resolvedReservationId = reservation.id;
    reportedAccountId = isBuyer ? reservation.sellerId : reservation.buyerId;
  } else if (listingIdInput) {
    const listing = ctx.db.listings.find((l) => l.id === listingIdInput);
    if (!listing) {
      return errorResult(422, "REPORT_TARGET_INVALID", "Không tìm thấy tin đăng để báo cáo.");
    }
    resolvedListingId = listing.id;
    reportedAccountId = listing.sellerId;
  } else if (accountIdInput) {
    const targetAccount = ctx.db.accounts.find((a) => a.id === accountIdInput);
    if (!targetAccount || getAccountDeletedAt(targetAccount)) {
      return errorResult(422, "REPORT_TARGET_INVALID", "Không tìm thấy tài khoản để báo cáo.");
    }
    reportedAccountId = targetAccount.id;
  }

  if (!reportedAccountId || reportedAccountId === acc.id) {
    return errorResult(422, "REPORT_TARGET_INVALID", "Không thể tự báo cáo tin đăng hoặc tài khoản của chính bạn.");
  }

  // Contract §0 rate limit: 10 reports per day per account.
  const today = localDay(ctx.now.toISOString());
  const todayCount = loadReports().filter(
    (r) => r.reporterId === acc.id && localDay(r.createdAt) === today,
  ).length;
  if (todayCount >= MAX_REPORTS_PER_DAY) {
    return errorResult(429, "RATE_LIMITED", "Bạn đã đạt giới hạn 10 báo cáo trong ngày. Vui lòng thử lại sau.");
  }

  // Contract REP-1 / DOMAIN §3: UNSAFE_FOOD hides the listing immediately until admin acts.
  if (type === "UNSAFE_FOOD" && resolvedListingId) {
    const targetListing = ctx.db.listings.find((l) => l.id === resolvedListingId);
    if (targetListing) {
      targetListing.underReview = true;
    }
  }

  const report: DbReport = {
    id: rid("rep"),
    reporterId: acc.id,
    type,
    listingId: resolvedListingId,
    reservationId: resolvedReservationId,
    reportedAccountId,
    description,
    imageIds: [...rawImageIds],
    status: "OPEN",
    action: null,
    resolution: null,
    handledBy: null,
    handledAt: null,
    createdAt: ctx.now.toISOString(),
  };

  addReport(report);

  return {
    status: 201,
    body: { data: toReportView(ctx.db, report, acc.role === "ADMIN") },
  };
}

function handleGetMe(ctx: TrustMockContext): TrustMockResult {
  // Contract §0: SUSPENDED account can still call ME-1.
  const auth = resolveUser(ctx, { allowSuspended: true });
  if ("error" in auth) return auth.error;
  return { status: 200, body: { data: toMeWithAvatar(ctx.db, auth.acc) } };
}

function handlePatchMe(ctx: TrustMockContext): TrustMockResult {
  const auth = resolveUser(ctx);
  if ("error" in auth) return auth.error;
  const acc = auth.acc;

  const b = objectBody<UpdateProfilePatch>(ctx.body);

  if (b.displayName !== undefined) {
    const n = String(b.displayName).trim();
    if (n.length < 2 || n.length > 40) {
      return errorResult(400, "VALIDATION_FAILED", "Tên hiển thị cần 2–40 ký tự.", {
        fields: { displayName: "2-40" },
      });
    }
    acc.displayName = n;
  }

  if (b.avatarImageId !== undefined) {
    if (b.avatarImageId === null) {
      setAccountAvatarImageId(acc, null);
    } else if (typeof b.avatarImageId === "string" && b.avatarImageId.trim()) {
      const img = ctx.db.images.find((i) => i.id === b.avatarImageId);
      if (!img) {
        return errorResult(404, "IMAGE_NOT_FOUND", "Không tìm thấy ảnh đại diện.");
      }
      setAccountAvatarImageId(acc, img.id);
    } else {
      return errorResult(400, "VALIDATION_FAILED", "Ảnh đại diện không hợp lệ.", {
        fields: { avatarImageId: "invalid" },
      });
    }
  }

  if (b.seller !== undefined && b.seller !== null) {
    if (b.seller.name !== undefined) {
      if (b.seller.name === null || b.seller.name.trim() === "") {
        acc.seller.name = null;
      } else {
        const name = b.seller.name.trim();
        if (name.length > 60) {
          return errorResult(400, "VALIDATION_FAILED", "Tên người bán tối đa 60 ký tự.", {
            fields: { "seller.name": "max 60" },
          });
        }
        acc.seller.name = name;
      }
    }

    if (b.seller.type !== undefined) {
      if (b.seller.type === null) {
        acc.seller.type = null;
      } else if ((SELLER_TYPES as readonly string[]).includes(b.seller.type)) {
        acc.seller.type = b.seller.type as SellerType;
      } else {
        return errorResult(400, "VALIDATION_FAILED", "Loại hình người bán không hợp lệ.", {
          fields: { "seller.type": "invalid" },
        });
      }
    }

    if (b.seller.defaultPickup !== undefined) {
      if (b.seller.defaultPickup === null) {
        acc.seller.defaultPickup = null;
      } else {
        const dp = b.seller.defaultPickup;
        const addr = typeof dp.address === "string" ? dp.address.trim() : "";
        if (!addr || !Number.isFinite(dp.lat) || !Number.isFinite(dp.lng)) {
          return errorResult(400, "VALIDATION_FAILED", "Địa điểm nhận mặc định cần địa chỉ và tọa độ hợp lệ.", {
            fields: { "seller.defaultPickup": "invalid" },
          });
        }
        acc.seller.defaultPickup = { address: addr, lat: dp.lat, lng: dp.lng };
      }
    }
  }

  return { status: 200, body: { data: toMeWithAvatar(ctx.db, acc) } };
}

function handleDeleteMe(ctx: TrustMockContext): TrustMockResult {
  const auth = resolveUser(ctx);
  if ("error" in auth) return auth.error;
  const acc = auth.acc;

  const b = objectBody<{ confirm?: string }>(ctx.body);
  if (b.confirm !== DELETE_ACCOUNT_CONFIRM) {
    return errorResult(
      400,
      "VALIDATION_FAILED",
      `Vui lòng nhập chính xác "${DELETE_ACCOUNT_CONFIRM}" để xác nhận xóa tài khoản.`,
      { fields: { confirm: DELETE_ACCOUNT_CONFIRM } },
    );
  }

  const activeReservations = ctx.db.reservations.filter(
    (r) => (r.buyerId === acc.id || r.sellerId === acc.id) && r.status === "RESERVED",
  ).length;
  const activeListings = ctx.db.listings.filter(
    (l) => l.sellerId === acc.id && l.status === "PUBLISHED",
  ).length;

  if (activeReservations > 0 || activeListings > 0) {
    return errorResult(
      409,
      "ACCOUNT_HAS_ACTIVE_ITEMS",
      "Bạn vẫn còn đơn đang giữ chỗ hoặc tin đang đăng. Hãy hoàn tất, hủy hoặc gỡ trước khi xóa tài khoản.",
      { activeReservations, activeListings },
    );
  }

  // Contract ME-3: soft-delete account and anonymise personal data.
  acc.phone = null;
  acc.email = null;
  acc.displayName = "Người dùng đã xóa";
  setAccountAvatarImageId(acc, null);
  acc.seller = { name: null, type: null, verified: false, defaultPickup: null };
  acc.status = "SUSPENDED";
  markAccountDeleted(acc, ctx.now.toISOString());

  // Contract ME-3: delete the account's own DRAFT listings; keep anonymised reservations/reports.
  ctx.db.listings = ctx.db.listings.filter((l) => !(l.sellerId === acc.id && l.status === "DRAFT"));

  // Revoke session tokens.
  ctx.session.set(null);

  return { status: 204 };
}

function handleLogout(ctx: TrustMockContext): TrustMockResult {
  ctx.session.set(null);
  return { status: 204 };
}

/**
 * Trust & settings mock handler for integration into `mockFetch.ts`.
 * Covers:
 * - `POST /reports` (REP-1)
 * - `GET /me` (ME-1 with avatar)
 * - `PATCH /me` (ME-2 with avatarImageId + seller fields)
 * - `DELETE /me` (ME-3 with active-items check + anonymisation)
 * - `POST /auth/logout` (AUTH-4 with optional allDevices)
 *
 * Returns `null` when the request path/method is not handled here.
 */
export function handleTrustMock(ctx: TrustMockContext): TrustMockResult | null {
  const { method, path } = ctx;
  if (method === "POST" && path === "/reports") return handleCreateReport(ctx);
  if (method === "GET" && path === "/me") return handleGetMe(ctx);
  if (method === "PATCH" && path === "/me") return handlePatchMe(ctx);
  if (method === "DELETE" && path === "/me") return handleDeleteMe(ctx);
  if (method === "POST" && path === "/auth/logout") return handleLogout(ctx);
  return null;
}
