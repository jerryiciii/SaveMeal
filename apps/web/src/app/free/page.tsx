import type { Metadata } from "next";
import { FreeFoodScreen } from "@/features/discover/FreeFoodScreen";

export const metadata: Metadata = { title: "Món miễn phí hôm nay" };

export default function FreeFoodPage() {
  return <FreeFoodScreen />;
}
