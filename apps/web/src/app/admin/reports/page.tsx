import type { Metadata } from "next";
import { ReportsScreen } from "@/features/admin/ReportsScreen";

export const metadata: Metadata = { title: "Báo cáo vi phạm" };

export default function AdminReportsPage() {
  return <ReportsScreen />;
}
