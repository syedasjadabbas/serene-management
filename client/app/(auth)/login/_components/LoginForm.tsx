"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { type FormEvent, useState } from "react";
import { useDispatch } from "react-redux";
import { Alert } from "@/global/components/ui/Alert";
import { Button } from "@/global/components/ui/Button";
import { PasswordField } from "@/global/components/ui/PasswordField";
import { TextField } from "@/global/components/ui/TextField";
import { baseApi } from "@/global/api/baseApi";
import { useLoginMutation } from "@/global/api/endpoints/sessionApi";
import { toClientApiError } from "@/global/api/errors";
import { useAuthStore } from "@/global/stores/auth.store";
import { loginSchema } from "@serene/shared/modules/identity/identity.schema";

/** What to tell the user when the server ended their session (`?reason=<code>`). */
const REASON_FALLBACK = "Your session has ended. Sign in again to continue.";

export function LoginForm({ next, reason }: { next: string; reason: string | null }) {
  const router = useRouter();
  const dispatch = useDispatch();
  const [login, { isLoading, error }] = useLoginMutation();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const apiError = toClientApiError(error);
  const endedBy = useAuthStore((state) => state.endedBy);
  // The server's own message when this page was reached by client navigation; a
  // generic line after a full reload (the reason code stays in the URL).
  const sessionNotice = endedBy?.message ?? (reason ? REASON_FALLBACK : null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });
    if (!parsed.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        errors[key] = [key === "email" ? "Enter a valid email address" : "Enter your password"];
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    const result = await login(parsed.data);
    if ("data" in result) {
      dispatch(baseApi.util.resetApiState());
      router.replace(next as Route);
    }
  }

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {sessionNotice && !apiError ? <Alert tone="warning">{sessionNotice}</Alert> : null}
      {apiError ? (
        <Alert tone="danger">
          {apiError.code === "RATE_LIMITED"
            ? "Too many attempts. Please wait a minute and try again."
            : apiError.message}
        </Alert>
      ) : null}
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        placeholder="name@hotel.com"
        required
        autoFocus
        controlSize="lg"
        errors={fieldErrors.email}
      />
      <PasswordField
        label="Password"
        name="password"
        autoComplete="current-password"
        placeholder="Enter your password"
        required
        controlSize="lg"
        errors={fieldErrors.password}
      />
      <Button type="submit" size="touch" pending={isLoading} className="mt-1 w-full">
        Sign in
      </Button>
    </form>
  );
}
