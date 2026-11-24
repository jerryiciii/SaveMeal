import type { Metadata } from "next";
import { RequireAuth } from "@/features/auth/SessionProvider";
import { PostChecklist } from "@/features/post/PostChecklist";

export const metadata: Metadata = { title: "Kiểm tra an toàn" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireAuth>
      <PostChecklist id={id} />
    </RequireAuth>
  );
}