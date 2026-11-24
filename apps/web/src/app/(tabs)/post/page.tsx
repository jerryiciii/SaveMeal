import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Đăng món" };

/** Figma V1 07 · Đăng pass món (2:324). Built in FE M5. */
export default function PostPage() {
  return <ComingSoon title="Đăng pass đồ ăn" subtitle="Cứu món ngon, giảm lãng phí." milestone="M5" />;
}
