import type { Metadata } from "next";
import { DiscoverScreen } from "@/features/discover/DiscoverScreen";

export const metadata: Metadata = { title: "Khám phá" };

export default function DiscoverPage() {
  return <DiscoverScreen />;
}
