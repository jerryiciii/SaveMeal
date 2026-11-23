import type { Metadata } from "next";
import { RequireAuth } from "@/features/auth/SessionProvider";
import { PostDetails } from "@/features/post/PostDetails";

export const metadata: Metadata = { title: "Đăng món · Bước 2/3" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireAuth>
      <PostDetails id={id} />
    </RequireAuth>
  );
}