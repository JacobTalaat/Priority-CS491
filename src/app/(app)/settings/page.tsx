import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { CanvasConnection } from "./canvas-connection";
import { CalendarFeed } from "./calendar-feed";
import { AccountDeletion } from "./account-deletion";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader eyebrow="Account" title="Settings" />
      <CanvasConnection />
      <CalendarFeed />
      <AccountDeletion />
    </>
  );
}
