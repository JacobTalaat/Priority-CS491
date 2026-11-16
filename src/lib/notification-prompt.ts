// When to offer browser notifications. The offer waits until the student has
// confirmed a class, so it never appears on first load, and a "Not now" is
// remembered so it doesn't come back after every confirm.

export const PROMPT_DISMISSED_KEY = "priority-notification-prompt-dismissed";

export type PromptContext = {
  // This save confirmed a class for the first time, not an edit of one.
  firstConfirm: boolean;
  // Notification.permission, or null when the browser has no web push.
  permission: NotificationPermission | null;
  alreadySubscribed: boolean;
  dismissed: boolean;
};

export function shouldOfferNotifications(context: PromptContext): boolean {
  return (
    context.firstConfirm &&
    context.permission === "default" &&
    !context.alreadySubscribed &&
    !context.dismissed
  );
}

export function readPromptDismissed(): boolean {
  try {
    return window.localStorage.getItem(PROMPT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function savePromptDismissed(): void {
  try {
    window.localStorage.setItem(PROMPT_DISMISSED_KEY, "1");
  } catch {
    // Without storage the offer may show again after the next confirm; that's fine.
  }
}

export function browserPermission(): NotificationPermission | null {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    !("PushManager" in window) ||
    !("serviceWorker" in navigator)
  ) {
    return null;
  }
  return Notification.permission;
}
