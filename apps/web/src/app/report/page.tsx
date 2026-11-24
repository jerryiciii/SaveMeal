import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAuth } from "@/features/auth/SessionProvider";
import { ReportScreen } from "@/features/report/ReportScreen";

export const metadata: Metadata = { title: "Báo cáo chất lượng" };

export default function ReportPage() {
  return (
    <RequireAuth>
      <Suspense>
        <ReportScreen />
      </Suspense>
    </RequireAuth>
  );
}
