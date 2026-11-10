import type { Metadata } from "next";
import { Onboarding } from "./onboarding";

export const metadata: Metadata = { title: "First run setup" };

export default function OnboardingPage() {
  return <Onboarding />;
}
