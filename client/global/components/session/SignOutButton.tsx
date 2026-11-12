"use client";

import { useRouter } from "next/navigation";
import { Button, type ButtonProps } from "@/global/components/ui/Button";
import { useLogoutMutation } from "@/global/api/endpoints/sessionApi";
import { useEndSession } from "@/global/hooks/useEndSession";

/**
 * Signs out, clears the access token, every cached server response and the
 * offline copy in this browser, and returns to the login page.
 */
export function SignOutButton(props: Omit<ButtonProps, "onClick" | "pending">) {
  const router = useRouter();
  const endSession = useEndSession();
  const [logout, { isLoading }] = useLogoutMutation();

  async function signOut() {
    // Sign-out must complete locally even if the request fails (the refresh
    // cookie is cleared by the server response; a stale session still expires).
    await logout().catch(() => undefined);
    await endSession();
    router.replace("/login");
  }

  return (
    <Button variant="ghost" {...props} pending={isLoading} onClick={signOut}>
      {props.children ?? "Sign out"}
    </Button>
  );
}
