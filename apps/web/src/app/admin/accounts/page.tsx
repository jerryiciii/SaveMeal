import type { Metadata } from "next";
import { AccountsScreen } from "@/features/admin/AccountsScreen";

export const metadata: Metadata = { title: "Quản lý tài khoản" };

export default function AdminAccountsPage() {
  return <AccountsScreen />;
}
