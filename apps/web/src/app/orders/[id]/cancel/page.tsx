import type { Metadata } from "next";
import { RequireAuth } from "@/features/auth/SessionProvider";
import { CancelScreen } from "@/features/orders/CancelScreen";

export const metadata: Metadata = { title: "Hủy đơn" };

export default async function CancelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireAuth>
      <CancelScreen id={id} />
    </RequireAuth>
  );
}
