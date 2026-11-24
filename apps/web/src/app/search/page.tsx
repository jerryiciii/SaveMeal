import type { Metadata } from "next";
import { SearchScreen } from "@/features/discover/SearchScreen";

export const metadata: Metadata = { title: "Tìm kiếm" };

export default function SearchPage() {
  return <SearchScreen />;
}
