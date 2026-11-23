import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Cá nhân" };

/** Figma V1 08 / 35 · Tài khoản (2:350, 11:84). Built in FE M2. */
export default function AccountPage() {
  return <ComingSoon title="Tài khoản" subtitle="Một tài khoản, hai cách cứu món" milestone="M2" />;
}
