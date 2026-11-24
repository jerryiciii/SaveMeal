import type { Metadata } from "next";
import { SellerProfileScreen } from "@/features/seller-profile/SellerProfileScreen";

export const metadata: Metadata = { title: "Hồ sơ người bán" };

/** Figma V1 16 · Seller or store profile (7:204). Public route. */
export default async function SellerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SellerProfileScreen id={id} />;
}
