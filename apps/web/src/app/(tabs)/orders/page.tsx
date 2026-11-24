import type { Metadata } from "next";
import { RequireAuth } from "@/features/auth/SessionProvider";
import { OrdersScreen } from "@/features/orders/OrdersScreen";

export const metadata: Metadata = { title: "Đơn của tôi" };

/** Figma V1 17 · Đơn của tôi (8:2). */
export default function OrdersPage() {
  return (
    <RequireAuth>
      <OrdersScreen />
    </RequireAuth>
  );
}
