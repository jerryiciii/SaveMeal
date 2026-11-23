import type { Metadata } from "next";
import { ListingDetailScreen } from "@/features/listing/ListingDetailScreen";

export const metadata: Metadata = { title: "Chi tiết món" };

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ListingDetailScreen id={id} />;
}
