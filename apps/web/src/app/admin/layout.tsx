import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "@/features/admin/AdminShell";

export const metadata: Metadata = {
  title: { default: "Quản trị", template: "%s · Quản trị · SaveMeal" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
