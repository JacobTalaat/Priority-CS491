import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell/app-shell";
import { AuthGuard } from "@/components/app-shell/auth-guard";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <AppShell>{children}</AppShell>
    </AuthGuard>
  );
}
