import { onSessionChange } from "@/lib/auth-client";
import { clearToken, getToken, setToken } from "@/lib/session";

// Keeps the stored token in step with Supabase's work in the background:
// supabase-js refreshes the access token on its own, without this the copy
// every API request reads goes stale while a tab stays open. On sign-out the
// token is cleared as well. Returns a stop function for the component cleanup.
export function startSessionSync(onSignedOut: () => void): () => void {
  const stop = onSessionChange((token) => {
    if (token) {
      if (getToken() !== token) {
        setToken(token);
      }
      return;
    }
    clearToken();
    onSignedOut();
  });
  return stop;
}
