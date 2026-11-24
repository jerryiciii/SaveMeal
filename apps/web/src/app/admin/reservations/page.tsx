import type { Metadata } from "next";
import { ReservationsScreen } from "@/features/admin/ReservationsScreen";

export const metadata: Metadata = { title: "Đơn đặt giữ" };

export default function AdminReservationsPage() {
  return <ReservationsScreen />;
}
