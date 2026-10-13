import type { Metadata } from "next";
import { WeightsSetup } from "./weights-setup";

export const metadata: Metadata = { title: "Weights" };

export default function WeightsPage() {
  return <WeightsSetup />;
}
