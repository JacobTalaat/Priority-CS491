import Image from "next/image";
import type { Metadata } from "next";
import { ButtonLink, PageHeader } from "@/components/ui";
import styles from "./guide.module.css";

export const metadata: Metadata = { title: "Canvas token guide" };

const screenshots = {
  accountSettings:
    "https://us.v-cdn.net/6038536/uploads/migrated/6NPFKWE5N9FQ/087a0df3-d31a-4727-ba4d-768c98229a9e.png",
  addToken:
    "https://us.v-cdn.net/6038536/uploads/migrated/M1I65C05YY2A/eecf28c8-2010-41ce-ba62-c516cf3cf0df.png",
  tokenDetails:
    "https://us.v-cdn.net/6038536/uploads/migrated/MA90FZPYEPEY/306f43f1-0fec-4693-acd6-bf3b69000f6b.png",
};

export default function CanvasTokenGuidePage() {
  return (
    <>
      <PageHeader
        eyebrow="Connect Canvas"
        title="Make an access token"
        description="Follow these steps in your school’s Canvas site, then paste the token into Priority."
      />

      <article className={styles.guide}>
        <ol className={styles.steps}>
          <li>
            <h2>Open your Canvas settings</h2>
            <p>
              In Canvas, open <strong>Account</strong> in the global navigation, then choose{" "}
              <strong>Settings</strong>.
            </p>
            <figure className={styles.figure}>
              <Image
                className={styles.screenshot}
                src={screenshots.accountSettings}
                alt="Canvas global navigation with Account and Settings highlighted."
                width={457}
                height={617}
                sizes="(max-width: 720px) 100vw, 640px"
              />
              <figcaption>Canvas Account and Settings navigation.</figcaption>
            </figure>
          </li>
          <li>
            <h2>Start a new access token</h2>
            <p>
              In <strong>Approved Integrations</strong>, select <strong>Add New Access Token</strong>.
            </p>
            <figure className={styles.figure}>
              <Image
                className={styles.screenshot}
                src={screenshots.addToken}
                alt="Canvas User Settings with Add New Access Token highlighted."
                width={846}
                height={539}
                sizes="(max-width: 720px) 100vw, 640px"
              />
              <figcaption>Find Add New Access Token in Approved Integrations.</figcaption>
            </figure>
          </li>
          <li>
            <h2>Name, expire, and generate it</h2>
            <p>
              Enter <strong>Priority</strong> as the purpose. Choose an expiration date that works for you,
              then select <strong>Generate Token</strong>.
            </p>
            <figure className={styles.figure}>
              <Image
                className={styles.screenshot}
                src={screenshots.tokenDetails}
                alt="Canvas New Access Token dialog with the purpose, expiration, and Generate Token controls highlighted."
                width={832}
                height={506}
                sizes="(max-width: 720px) 100vw, 640px"
              />
              <figcaption>Give the token a recognizable purpose and an expiration date.</figcaption>
            </figure>
          </li>
          <li>
            <h2>Copy it into Priority</h2>
            <p>
              Copy the token as soon as Canvas shows it; you may not be able to see it again. Return to{" "}
              <strong>Priority → Settings → Canvas</strong>, paste it into <strong>Canvas access token</strong>,
              check the Canvas address is your school’s Canvas URL, and select <strong>Connect Canvas</strong>.
              Keep the token private. If Canvas won’t let you create one, ask your school’s Canvas administrator.
            </p>
          </li>
        </ol>

        <p className={styles.source}>
          Screenshots and steps adapted from{" "}
          <a
            href="https://community.instructure.com/en/kb/articles/662901-how-do-i-manage-api-access-tokens-in-my-user-account"
            target="_blank"
            rel="noreferrer"
          >
            Instructure’s Canvas access-token guide
          </a>
          . Your school’s Canvas layout may look different.
        </p>
        <ButtonLink href="/settings" variant="secondary">Back to Canvas settings</ButtonLink>
      </article>
    </>
  );
}
