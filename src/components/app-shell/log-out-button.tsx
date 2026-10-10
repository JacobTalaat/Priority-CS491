"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { clearToken } from "@/lib/session";

export function LogOutButton() {
  const router = useRouter();

  function handleLogOut() {
    clearToken();
    router.replace("/login");
  }

  return (
    <Button variant="ghost" onClick={handleLogOut}>
      Log out
    </Button>
  );
}
