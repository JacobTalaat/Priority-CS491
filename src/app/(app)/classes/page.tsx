import type { Metadata } from "next";
import { ClassesList } from "./classes-list";

export const metadata: Metadata = { title: "Classes" };

export default function ClassesPage() {
  return <ClassesList />;
}
