import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAuth } from "@/features/auth/SessionProvider";
import { OrderScreen } from "@/features/orders/OrderScreen";

export const metadata: Metadata = { title: "Mã nhận món" };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireAuth>
      <Suspense>
        <OrderScreen id={id} />
      </Suspense>
    </RequireAuth>
  );
}
