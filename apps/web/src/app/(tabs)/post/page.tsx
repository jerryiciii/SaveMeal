import type { Metadata } from "next";
import { RequireAuth } from "@/features/auth/SessionProvider";
import { PostStep1 } from "@/features/post/PostStep1";

export const metadata: Metadata = { title: "Đăng món" };

/** Figma V1 07 · Đăng pass món (2:324). */
export default function PostPage() {
  return (
    <RequireAuth>
      <PostStep1 />
    </RequireAuth>
  );
}
