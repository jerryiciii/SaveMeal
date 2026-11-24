import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAuth } from "@/features/auth/SessionProvider";
import { SaleDone } from "@/features/seller/SaleDone";

export const metadata: Metadata = { title: "Giao hàng hoàn tất" };

/** Figma V1 32 · Xác nhận đã giao thành công (10:88). */
export default function SaleDonePage() {
  return (
    <RequireAuth>
      <Suspense>
        <SaleDone />
      </Suspense>
    </RequireAuth>
  );
}