import type { Metadata } from "next";
import { RequireAuth } from "@/features/auth/SessionProvider";
import { SettingsScreen } from "@/features/settings/SettingsScreen";

export const metadata: Metadata = { title: "Cài đặt & PWA" };

export default function SettingsPage() {
  return (
    <RequireAuth>
      <SettingsScreen />
    </RequireAuth>
  );
}
