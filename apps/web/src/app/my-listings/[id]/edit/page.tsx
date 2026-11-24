import type { Metadata } from "next";
import { RequireAuth } from "@/features/auth/SessionProvider";
import { EditListingScreen } from "@/features/seller/EditListingScreen";

export const metadata: Metadata = { title: "Chỉnh sửa tin đăng" };

/** Figma V1 33 · Chỉnh sửa & tạm dừng tin (11:2). */
export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireAuth>
      <EditListingScreen id={id} />
    </RequireAuth>
  );
}
