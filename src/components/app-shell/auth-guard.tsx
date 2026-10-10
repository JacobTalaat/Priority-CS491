"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { checkSession } from "@/lib/auth-client";
import type { AuthUser } from "@/lib/auth-client";
import { loginPathFor } from "@/lib/redirect";
import { TOKEN_KEY, clearToken, getToken } from "@/lib/session";
import styles from "./app-shell.module.css";

type GuardState = { status: "checking" } | { status: "ready"; user: AuthUser | null };

const CurrentUserContext = createContext<AuthUser | null>(null);

// The signed in student, or null if their session couldn't be confirmed (e.g. offline).
export function useCurrentUser() {
  return useContext(CurrentUserContext);
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<GuardState>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;

    function sendToLogin() {
      router.replace(loginPathFor(window.location.pathname + window.location.search));
    }

    const token = getToken();
    if (!token) {
      sendToLogin();
      return;
    }

    checkSession(token).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.status === "invalid") {
        clearToken();
        sendToLogin();
        return;
      }
      setState({ status: "ready", user: result.status === "valid" ? result.user : null });
    });

    // Logging out in another tab logs this one out too.
    function handleStorage(event: StorageEvent) {
      if (event.key === TOKEN_KEY && !event.newValue) {
        sendToLogin();
      }
    }
    window.addEventListener("storage", handleStorage);

    return () => {
      cancelled = true;
      window.removeEventListener("storage", handleStorage);
    };
  }, [router]);

  if (state.status === "checking") {
    return (
      <div className={styles.checking} role="status" aria-live="polite">
        Loading…
      </div>
    );
  }

  return <CurrentUserContext.Provider value={state.user}>{children}</CurrentUserContext.Provider>;
}
