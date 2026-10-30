import { apiRequest } from "./api-client";
import { getToken } from "./session";

// Records a usage event for the study. Fire and forget: logging must never slow down or
// break the page, so failures are ignored and nothing is sent when logged out.
export function logEvent(event: string): void {
  const token = getToken();
  if (!token) {
    return;
  }
  void apiRequest("/api/events", { method: "POST", token, body: { event, client: "web" } });
}
