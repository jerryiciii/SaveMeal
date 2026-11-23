import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Đã lưu" };

/** Figma V1 15 · Saved listings (7:168). Built in FE M4. */
export default function SavedPage() {
  return <ComingSoon title="Đã lưu" subtitle="Những món bạn muốn quay lại xem" milestone="M4" />;
}
