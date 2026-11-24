import type { Metadata } from "next";
import { FiltersScreen } from "@/features/discover/FiltersScreen";

export const metadata: Metadata = { title: "Bộ lọc" };

export default function FiltersPage() {
  return <FiltersScreen />;
}
