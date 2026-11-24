import type { Metadata } from "next";
import { RequireAuth } from "@/features/auth/SessionProvider";
import { AccountScreen } from "@/features/account/AccountScreen";

export const metadata: Metadata = { title: "Cá nhân" };

/** Figma V1 08 / 35 · Tài khoản mua & bán (2:350, 11:84). */
export default function AccountPage() {
  return (
    <RequireAuth>
      <AccountScreen />
    </RequireAuth>
  );
}