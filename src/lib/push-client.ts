import { apiRequest } from "./api-client";
import { getToken } from "./session";

// Everything here goes out with the same bearer token as every other route: a
// saved push subscription belongs to exactly one account.
export type PushSubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export function getPushPublicKey() {
  return apiRequest<{ publicKey: string }>("/api/push/public-key", { token: getToken() });
}

export function savePushSubscription(subscription: PushSubscriptionPayload) {
  return apiRequest<{ subscribed: boolean }>("/api/push/subscriptions", {
    method: "POST",
    token: getToken(),
    body: subscription,
  });
}

export function deletePushSubscription(endpoint: string) {
  return apiRequest<{ removed: boolean }>("/api/push/subscriptions", {
    method: "DELETE",
    token: getToken(),
    body: { endpoint },
  });
}

export function sendTestPush() {
  return apiRequest<{ sent: number; failed: number; removed: number }>("/api/push/test", {
    method: "POST",
    token: getToken(),
  });
}

// Called right before logout clears the token: the token is read synchronously
// so the DELETE is sent before the session could be considered gone, and every
// failure — from push being unsupported to a network error — is swallowed so
// logout itself never gets stuck.
export function unsubscribeBeforeLogout(): void {
  const token = getToken();
  void (async () => {
    try {
      if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) {
        return;
      }
      await fetch("/api/push/subscriptions", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => {});
      await subscription.unsubscribe().catch(() => {});
    } catch {
      // Logout must still complete if push is broken or unsupported.
    }
  })();
}
