import type { Metadata } from "next";
import { List, ListRow, PageHeader } from "@/components/ui";
import { CanvasConnection } from "./canvas-connection";
import styles from "./settings.module.css";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader eyebrow="Account" title="Settings" />
      <CanvasConnection />
      <div className={styles.rest}>
        <List label="More settings">
          <ListRow title="Calendar feed" meta="A backup way to load assignments" trailing="Soon" />
          <ListRow title="Account" meta="Your email and password" trailing="Soon" />
        </List>
      </div>
    </>
  );
}
