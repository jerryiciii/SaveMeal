import type { SellerType } from "@/lib/contract/types";
import { APP_TIME_ZONE } from "@/lib/format";

/** Vietnamese labels for SellerType (docs/API_CONTRACT.md §1, Figma V1 16). */
export const SELLER_TYPE_LABEL: Record<SellerType, string> = {
  INDIVIDUAL: "Cá nhân",
  SHOP: "Cửa hàng",
  CAFE: "Quán cà phê",
  BAKERY: "Tiệm bánh",
  CANTEEN: "Căng tin",
};

/** Formats ISO date into "Thg 11/2026" in Vietnam local time. */
export function formatMemberSince(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    month: "numeric",
    year: "numeric",
  }).formatToParts(date);
  const month = parts.find((p) => p.type === "month")?.value;
  const year = parts.find((p) => p.type === "year")?.value;
  if (!month || !year) return "—";
  return `Thg ${month}/${year}`;
}

/** 1–2 uppercase initials for the seller avatar placeholder. */
export function sellerInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "SM";
  if (words.length === 1) return words[0]!.slice(0, 2).toLocaleUpperCase("vi");
  return `${words[0]![0] ?? ""}${words[words.length - 1]![0] ?? ""}`.toLocaleUpperCase("vi");
}
