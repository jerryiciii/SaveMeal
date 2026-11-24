import type { Metadata } from "next";
import { ListingsScreen } from "@/features/admin/ListingsScreen";

export const metadata: Metadata = { title: "Quản lý tin đăng" };

export default function AdminListingsPage() {
  return <ListingsScreen />;
}
