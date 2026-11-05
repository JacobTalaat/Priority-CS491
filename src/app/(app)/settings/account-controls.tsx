"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Notice } from "@/components/ui";
import { deleteAccount } from "@/lib/account-client";
import { clearToken } from "@/lib/session";
import { unsubscribeBeforeLogout } from "@/lib/push-client";
import styles from "./settings.module.css";

type Message = { tone: "error"; text: string } | null;

export function AccountControls() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [deleting, setDeleting] = useState(false);

  function cancel() {
    setConfirming(false);
    setPassword("");
    setUnderstood(false);
    setMessage(null);
  }

  async function handleDelete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setDeleting(true);
    const result = await deleteAccount(password);
    setDeleting(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error });
      return;
    }

    unsubscribeBeforeLogout();
    clearToken();
    router.replace("/signup");
  }

  return (
    <section className={styles.section} aria-labelledby="account-controls-heading">
      <div className={styles.sectionHeader}>
        <h2 id="account-controls-heading" className={styles.sectionTitle}>
          Account
        </h2>
      </div>
      <p className={styles.sectionNote}>
        Permanently delete your Priority account and its saved data.
      </p>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {!confirming ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            className={styles.deleteAccountButton}
            onClick={() => setConfirming(true)}
          >
            Delete account
          </Button>
        </div>
      ) : (
        <form className={styles.deleteAccountForm} onSubmit={handleDelete}>
          <Notice tone="warning">
            This permanently deletes your account and saved data. Enter your password and confirm to continue.
          </Notice>
          <Input
            label="Account password"
            name="deleteAccountPassword"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <label className={styles.deleteAccountConfirmation}>
            <input
              type="checkbox"
              name="confirmAccountDeletion"
              required
              checked={understood}
              onChange={(event) => setUnderstood(event.target.checked)}
            />
            <span>I understand this action cannot be undone.</span>
          </label>
          <div className={styles.actions}>
            <Button
              type="submit"
              variant="secondary"
              className={styles.deleteAccountButton}
              loading={deleting}
              disabled={!password || !understood || deleting}
            >
              {deleting ? "Deleting account…" : "Permanently delete account"}
            </Button>
            <Button type="button" variant="ghost" onClick={cancel} disabled={deleting}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
