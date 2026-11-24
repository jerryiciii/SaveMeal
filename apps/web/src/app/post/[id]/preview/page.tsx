import type { Metadata } from "next";
import { RequireAuth } from "@/features/auth/SessionProvider";
import { PostPreview } from "@/features/post/PostPreview";

export const metadata: Metadata = { title: "Xem trước tin" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireAuth>
      <PostPreview id={id} />
    </RequireAuth>
  );
}