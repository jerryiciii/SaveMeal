import type { SellerType } from "@/lib/contract/types";

/** Seller types from docs/DOMAIN.md §2 & API_CONTRACT.md §1. */
export const SELLER_TYPE_LABEL: Record<SellerType, string> = {
  INDIVIDUAL: "Cá nhân",
  SHOP: "Cửa hàng",
  CAFE: "Quán cà phê",
  BAKERY: "Tiệm bánh",
  CANTEEN: "Căng tin",
};
