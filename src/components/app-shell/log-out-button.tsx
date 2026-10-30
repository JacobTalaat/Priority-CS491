"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { logOut } from "@/lib/auth-client";
import { clearToken } from "@/lib/session";

export function LogOutButton() {
  const router = useRouter();

  async function handleLogOut() {
    // Supabase Auth also has to be told, or the session survives on the server.
    await logOut();
    clearToken();
    router.replace("/login");
  }

  return (
    <Button variant="ghost" onClick={handleLogOut}>
      Log out
    </Button>
  );
}
