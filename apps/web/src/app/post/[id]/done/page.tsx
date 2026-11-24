import type { Metadata } from "next";
import { RequireAuth } from "@/features/auth/SessionProvider";
import { PostDone } from "@/features/post/PostPreview";

export const metadata: Metadata = { title: "Đăng thành công" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireAuth>
      <PostDone id={id} />
    </RequireAuth>
  );
}