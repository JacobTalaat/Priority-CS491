"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui";
import { StatusPage } from "./status-page";

type ErrorViewProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

export function ErrorView({ error, retry }: ErrorViewProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusPage
      code="Error"
      title="Something went wrong"
      description="This page didn't load. It's usually temporary, so try again. If it keeps happening, let the team know."
      actions={
        <>
          <Button onClick={() => retry()}>Try again</Button>
          <ButtonLink href="/today" variant="secondary">
            Go to Today
          </ButtonLink>
        </>
      }
      footnote={error.digest ? `Error ID: ${error.digest}` : undefined}
    />
  );
}
