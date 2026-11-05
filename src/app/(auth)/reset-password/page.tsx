import type { Metadata } from "next";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Reset password" };

// Whether the reset link worked is only knowable in the browser: Supabase
// answers through the URL fragment, so every state this page can be in is
// rendered by the client form.
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
