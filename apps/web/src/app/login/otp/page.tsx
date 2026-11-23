import type { Metadata } from "next";
import { Suspense } from "react";
import { OtpScreen } from "@/features/auth/OtpScreen";

export const metadata: Metadata = { title: "Xác minh OTP" };

/** Figma V1 40 · Xác minh OTP (11:243). */
export default function OtpPage() {
  return (
    <Suspense>
      <OtpScreen />
    </Suspense>
  );
}
