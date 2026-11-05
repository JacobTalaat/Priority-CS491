"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { unsubscribeBeforeLogout } from "@/lib/push-client";
import { clearToken } from "@/lib/session";

export function LogOutButton() {
  const router = useRouter();

  function handleLogOut() {
    // Best-effort push cleanup runs in parallel with the redirect, but its
    // token is captured synchronously before the session looks gone; logout
    // still completes if push is unsupported or the request fails.
    try {
      unsubscribeBeforeLogout();
    } catch {
      // Nothing to clean up; never let it stop the log out itself.
    }
    clearToken();
    router.replace("/login");
  }

  return (
    <Button variant="ghost" onClick={handleLogOut}>
      Log out
    </Button>
  );
}
