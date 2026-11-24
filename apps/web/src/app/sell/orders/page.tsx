import type { Metadata } from "next";
import { RequireAuth } from "@/features/auth/SessionProvider";
import { SalesScreen } from "@/features/seller/SalesScreen";

export const metadata: Metadata = { title: "Đơn bán & xác nhận chuyển khoản" };

/** Alias route matching BE Resend email CTA (`/sell/orders`) -> renders Seller Sales & P2P proof review (30b). */
export default function SellOrdersPage() {
  return (
    <RequireAuth>
      <SalesScreen />
    </RequireAuth>
  );
}
