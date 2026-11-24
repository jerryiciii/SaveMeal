import type { Metadata } from "next";
import { LocationPermissionScreen } from "@/features/onboarding/LocationPermissionScreen";

export const metadata: Metadata = { title: "Vị trí của bạn" };

export default function OnboardingLocationPage() {
  return <LocationPermissionScreen />;
}
