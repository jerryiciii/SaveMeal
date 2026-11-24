import type { Metadata } from "next";
import { RequireAuth } from "@/features/auth/SessionProvider";
import { ReserveScreen } from "@/features/listing/ReserveScreen";

export const metadata: Metadata = { title: "Xác nhận đặt giữ" };

export default async function ReservePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireAuth>
      <ReserveScreen id={id} />
    </RequireAuth>
  );
}
