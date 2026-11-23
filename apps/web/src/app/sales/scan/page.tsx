import type { Metadata } from "next";
import { RequireAuth } from "@/features/auth/SessionProvider";
import { ScanScreen } from "@/features/seller/ScanScreen";

export const metadata: Metadata = { title: "Quét mã nhận món" };

/** Figma V1 31 · Quét QR và nhập mã (10:68). */
export default function ScanPage() {
  return (
    <RequireAuth>
      <ScanScreen />
    </RequireAuth>
  );
}