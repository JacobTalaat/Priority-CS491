import type { Metadata } from "next";
import { ButtonLink, PageHeader } from "@/components/ui";
import { CanvasConnection } from "./canvas-connection";
import { CalendarFeed } from "./calendar-feed";
import { DeleteAccount } from "./delete-account";
import { NotificationPreferences } from "./notification-preferences";
import { PushNotifications } from "./push-notifications";
import { TwoFactor } from "./two-factor";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { from } = await searchParams;
  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Settings"
        actions={from === "onboarding" ? <ButtonLink href="/onboarding" variant="secondary">Back to setup</ButtonLink> : undefined}
      />
      <CanvasConnection />
      <CalendarFeed />
      <NotificationPreferences />
      <PushNotifications />
      <TwoFactor />
      <DeleteAccount />
    </>
  );
}
