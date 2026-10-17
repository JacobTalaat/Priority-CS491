"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import { clearToken, getToken } from "@/lib/session";
import styles from "./settings.module.css";

export function AccountDeletion() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmation !== "DELETE") {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await apiRequest<{ deleted: true }>("/api/auth/account", {
      method: "DELETE",
      token: getToken(),
      body: { confirmation: "DELETE" },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    clearToken();
    router.replace("/signup");
  }

  return (
    <section className={styles.section} aria-labelledby="account-heading">
      <div className={styles.sectionHeader}>
        <h2 id="account-heading" className={styles.sectionTitle}>Account</h2>
      </div>
      <p className={styles.sectionNote}>
        Delete your Priority account, saved Canvas credentials, and associated synced classes, assignments,
        grades, and setup. This does not delete records held by Canvas or revoke your Canvas token in Canvas.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {confirming ? (
        <form className={styles.form} onSubmit={handleSubmit}>
          <p className={styles.sectionNote}>
            This action is permanent. Type DELETE to confirm account deletion.
          </p>
          <Input
            label="Type DELETE to confirm"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            required
          />
          <div className={styles.actions}>
            <Button
              type="submit"
              className={styles.dangerAction}
              loading={busy}
              disabled={confirmation !== "DELETE"}
            >
              {busy ? "Deleting account…" : "Permanently delete account"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setConfirmation("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.actions}>
          <Button
            className={styles.dangerAction}
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            Delete account
          </Button>
        </div>
      )}
    </section>
  );
}
