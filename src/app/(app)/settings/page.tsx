import type { Metadata } from "next";
import { List, ListRow, PageHeader } from "@/components/ui";
import { CanvasConnection } from "./canvas-connection";
import { CalendarFeed } from "./calendar-feed";
import { PushNotifications } from "./push-notifications";
import { AccountControls } from "./account-controls";
import styles from "./settings.module.css";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader eyebrow="Account" title="Settings" />
      <CanvasConnection />
      <CalendarFeed />
      <PushNotifications />
      <AccountControls />
      <div className={styles.rest}>
        <List label="More settings">
          <ListRow title="Calendar feed" meta="A backup way to load assignments" trailing="Soon" />
        </List>
      </div>
    </>
  );
}
