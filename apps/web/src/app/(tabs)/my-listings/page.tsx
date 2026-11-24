import type { Metadata } from "next";
import { RequireAuth } from "@/features/auth/SessionProvider";
import { MyListingsScreen } from "@/features/seller/MyListingsScreen";

export const metadata: Metadata = { title: "Tin của tôi" };

/** Figma V1 29 · Tin đang đăng & quản lý (10:2). */
export default function MyListingsPage() {
  return (
    <RequireAuth>
      <MyListingsScreen />
    </RequireAuth>
  );
}