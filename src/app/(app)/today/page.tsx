import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Today" };

export default function TodayPage() {
  return (
    <PageHeader
      eyebrow="Due soon"
      title="Today"
      description="Your assignments for today will show up here."
    />
  );
}
