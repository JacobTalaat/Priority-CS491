import type { Metadata } from "next";
import { ClassPage } from "./class-page";

export const metadata: Metadata = { title: "Class" };

export default async function ClassRoute({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return <ClassPage courseId={courseId} />;
}
