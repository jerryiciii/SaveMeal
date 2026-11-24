import type { ReportAction, ReportStatus } from "@/lib/api/adminEndpoints";
import type { AccountStatus, ListingStatus, ReportType, SellerType } from "@/lib/contract/types";
import { APP_TIME_ZONE } from "@/lib/format";

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  OPEN: "Chờ xử lý",
  IN_REVIEW: "Đang xem xét",
  RESOLVED: "Đã xử lý",
  DISMISSED: "Đã bỏ qua",
};

export const REPORT_ACTION_LABEL: Record<ReportAction, string> = {
  NONE: "Không xử lý thêm",
  WARNING: "Cảnh cáo",
  LISTING_BLOCKED: "Khóa tin đăng",
  ACCOUNT_SUSPENDED: "Tạm khóa tài khoản",
};

export const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  WRONG_INFO: "Thông tin sai lệch",
  UNSAFE_FOOD: "Nghi ngờ mất an toàn",
  NOT_RECEIVED: "Không nhận được món",
  SELLER_ABSENT: "Người bán không có mặt",
  OTHER: "Khác",
};

export const LISTING_STATUS_LABEL: Record<ListingStatus, string> = {
  DRAFT: "Bản nháp",
  PUBLISHED: "Đang hiển thị",
  EXPIRED: "Hết hạn",
  WITHDRAWN: "Đã gỡ",
  BLOCKED: "Bị khóa",
};

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  ACTIVE: "Đang hoạt động",
  SUSPENDED: "Đang tạm khóa",
};

export const SELLER_TYPE_LABEL: Record<SellerType, string> = {
  INDIVIDUAL: "Cá nhân",
  SHOP: "Cửa hàng",
  CAFE: "Quán cà phê",
  BAKERY: "Tiệm bánh",
  CANTEEN: "Căng tin",
};

/** 0.775 → "77,5%" */
export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1).replace(".", ",")}%`;
}

/** 5.5 → "5,5 giờ", null → "Chưa có dữ liệu" */
export function formatHours(hours: number | null): string {
  if (hours === null) return "Chưa có dữ liệu";
  return `${hours.toFixed(1).replace(".", ",")} giờ`;
}

/** ISO timestamp → "14:30 · 24/11/2026" in Đà Nẵng time */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const time = new Intl.DateTimeFormat("vi-VN", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  const day = new Intl.DateTimeFormat("vi-VN", {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  return `${time} · ${day}`;
}

/** ISO timestamp → "24/11/2026" in Đà Nẵng time */
export function formatDateOnly(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}
