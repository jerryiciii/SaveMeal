import type { Metadata } from "next";
import { OnboardingScreen } from "@/features/onboarding/OnboardingScreen";

export const metadata: Metadata = { title: "Chào mừng" };

export default function OnboardingPage() {
  return <OnboardingScreen />;
}
