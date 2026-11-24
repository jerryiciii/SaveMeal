import type { Category, ChecklistKey, DeclarationKey } from "@/lib/contract/types";

/** V1/12 food types. */
export const CATEGORY_LABEL: Record<Category, string> = {
  BAKERY: "Bánh",
  MEAL: "Cơm / đồ mặn",
  DRINK: "Đồ uống",
  PACKAGED: "Đóng gói",
  OTHER: "Khác",
};

/** V1/26 checklist labels (DOMAIN §5 seller declarations). */
export const DECLARATION_LABEL: Record<DeclarationKey, string> = {
  NOT_EXPIRED: "Món còn trong thời hạn sử dụng",
  STORED_PROPERLY: "Bảo quản đúng điều kiện",
  NOT_SPOILED: "Không hư hỏng hoặc biến chất",
  NOT_SERVED_LEFTOVERS: "Không phải thức ăn khách đã ăn dở",
  INFO_DECLARED: "Đã khai báo thành phần, dị ứng (khi có)",
  PICKUP_WINDOW_OK: "Khung giờ nhận vẫn phù hợp",
};

/** Required-info checklist (DOMAIN §5) shown when publish is blocked. */
export const CHECKLIST_LABEL: Record<ChecklistKey, string> = {
  PHOTO: "Ảnh thật của món",
  NAME: "Tên món",
  PRICE: "Giá bán (không cao hơn giá gốc)",
  PORTIONS: "Số suất",
  ORIGIN: "Nguồn gốc",
  PREPARED_AT: "Thời điểm chế biến / đóng gói",
  STORAGE: "Cách bảo quản",
  PICKUP_WINDOW: "Khung giờ nhận (tối đa 4 giờ, chưa qua)",
  PICKUP_LOCATION: "Địa điểm nhận",
};
