import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Weights" };

export default function WeightsPage() {
  return (
    <PageHeader
      eyebrow="Grade weights"
      title="Weights"
      description="Category weights for each class will show up here."
    />
  );
}
