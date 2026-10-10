"use client";

import { ErrorView } from "@/components/status-page/error-view";

// Errors inside a tab keep the header and tabs on screen, so students can move elsewhere.
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorView error={error} retry={retry} />;
}
