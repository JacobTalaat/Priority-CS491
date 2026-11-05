import type { Metadata } from "next";
import { ConfirmForm } from "./confirm-form";

export const metadata: Metadata = { title: "Confirm your email" };

export default function ConfirmEmailPage() {
  return <ConfirmForm />;
}
