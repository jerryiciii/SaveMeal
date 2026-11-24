import type { Metadata } from "next";
import { KpisScreen } from "@/features/admin/KpisScreen";

export const metadata: Metadata = { title: "KPIs" };

export default function AdminKpisPage() {
  return <KpisScreen />;
}
