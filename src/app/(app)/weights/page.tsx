import type { Metadata } from "next";
import { WeightsSetup } from "./weights-setup";

export const metadata: Metadata = { title: "Weights" };

// ?course=<id> opens that class, for example from its class page.
export default async function WeightsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { course } = await searchParams;
  return <WeightsSetup initialCourseId={typeof course === "string" ? course : undefined} />;
}
