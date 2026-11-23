import type { CancelReason, ReservationStatus, Storage } from "@/lib/contract/types";

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  RESERVED: "Đã giữ suất",
  COMPLETED: "Hoàn tất",
  CANCELLED: "Đã hủy",
  EXPIRED: "Hết giờ",
};

/** V1/39 reasons (buyer side) plus system reasons for display. */
export const CANCEL_REASON_LABEL: Record<CancelReason, string> = {
  BUYER_LATE: "Không kịp đến nhận",
  BUYER_WRONG_QTY: "Đặt nhầm số lượng",
  BUYER_CHANGED_PLAN: "Tôi đổi kế hoạch",
  BUYER_OTHER: "Lý do khác",
  SELLER_WITHDREW: "Người bán đã rút tin",
  LISTING_BLOCKED: "Tin đã bị gỡ",
  ADMIN: "Hủy bởi quản trị viên",
};

export const STORAGE_LABEL: Record<Storage, string> = {
  ROOM_TEMP: "Nhiệt độ phòng",
  CHILLED: "Ngăn mát",
  FROZEN: "Ngăn đông",
};
