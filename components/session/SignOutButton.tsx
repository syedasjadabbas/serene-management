"use client";

import { useRouter } from "next/navigation";
import { useDispatch } from "react-redux";
import { Button, type ButtonProps } from "@/components/ui/Button";
import { baseApi } from "@/lib/api/baseApi";
import { useLogoutMutation } from "@/lib/api/endpoints/session.api";

/** Signs out, clears every cached server response, and returns to the login page. */
export function SignOutButton(props: Omit<ButtonProps, "onClick" | "pending">) {
  const router = useRouter();
  const dispatch = useDispatch();
  const [logout, { isLoading }] = useLogoutMutation();

  async function signOut() {
    // Sign-out must complete locally even if the request fails (cookies are
    // cleared by the server response; a stale session still expires).
    await logout().catch(() => undefined);
    dispatch(baseApi.util.resetApiState());
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button variant="ghost" {...props} pending={isLoading} onClick={signOut}>
      {props.children ?? "Sign out"}
    </Button>
  );
}
