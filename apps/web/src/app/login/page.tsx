import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginScreen } from "@/features/auth/LoginScreen";

export const metadata: Metadata = { title: "Đăng nhập" };

/** Figma V1 10 · Sign in / Sign up (7:19). */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginScreen />
    </Suspense>
  );
}
