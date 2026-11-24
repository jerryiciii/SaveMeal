import type { ReportType } from "@/lib/contract/types";

/** Figma V1 23 · Báo cáo chất lượng (`8:351`) — Vietnamese copy per DOMAIN §2 & API_CONTRACT §8. */
export const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  UNSAFE_FOOD: "Thực phẩm có dấu hiệu không an toàn",
  WRONG_INFO: "Thông tin món không đúng thực tế",
  NOT_RECEIVED: "Không nhận được món",
  SELLER_ABSENT: "Người bán vắng mặt / đóng cửa",
  OTHER: "Vấn đề khác",
};

export const REPORT_TYPE_HINT: Record<ReportType, string> = {
  UNSAFE_FOOD: "Món có mùi lạ, hư hỏng, hết hạn hoặc không đảm bảo vệ sinh.",
  WRONG_INFO: "Giá, số lượng, thành phần hoặc ảnh thực tế không khớp tin đăng.",
  NOT_RECEIVED: "Đã đến đúng giờ nhưng không nhận được phần ăn đã giữ.",
  SELLER_ABSENT: "Quầy đóng cửa hoặc không liên hệ được người bán khi đến nhận.",
  OTHER: "Các vấn đề khác cần quản trị viên kiểm tra.",
};

/** Contract REP-1: these types require the caller's own `reservationId`. */
export const RESERVATION_REQUIRED_REPORT_TYPES: ReadonlySet<ReportType> = new Set([
  "NOT_RECEIVED",
  "SELLER_ABSENT",
]);

export function requiresReservation(type: ReportType): boolean {
  return RESERVATION_REQUIRED_REPORT_TYPES.has(type);
}
