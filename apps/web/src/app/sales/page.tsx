import type { Metadata } from "next";
import { RequireAuth } from "@/features/auth/SessionProvider";
import { SalesScreen } from "@/features/seller/SalesScreen";

export const metadata: Metadata = { title: "Đơn chờ nhận" };

/** Figma V1 30 · Đơn đang chờ người nhận (10:43). */
export default function SalesPage() {
  return (
    <RequireAuth>
      <SalesScreen />
    </RequireAuth>
  );
}