"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useDispatch } from "react-redux";
import { Alert } from "@/global/components/ui/Alert";
import { Button } from "@/global/components/ui/Button";
import { FormPasswordField, FormTextField, useZodForm } from "@/global/components/ui/form";
import { baseApi } from "@/global/api/baseApi";
import { useLoginMutation } from "@/global/api/endpoints/sessionApi";
import { toClientApiError } from "@/global/api/errors";
import { useAuthStore } from "@/global/stores/auth.store";
import { loginFormDefaults, loginFormSchema } from "../_lib/loginForm";

/** What to tell the user when the server ended their session (`?reason=<code>`). */
const REASON_FALLBACK = "Your session has ended. Sign in again to continue.";

export function LoginForm({ next, reason }: { next: string; reason: string | null }) {
  const router = useRouter();
  const dispatch = useDispatch();
  const [login, { isLoading, error }] = useLoginMutation();
  const { control, handleSubmit, formState } = useZodForm(loginFormSchema, loginFormDefaults);
  const apiError = toClientApiError(error);
  const endedBy = useAuthStore((state) => state.endedBy);
  // The server's own message when this page was reached by client navigation; a
  // generic line after a full reload (the reason code stays in the URL).
  const sessionNotice = endedBy?.message ?? (reason ? REASON_FALLBACK : null);

  async function onSubmit(values: { email: string; password: string }) {
    const result = await login(values);
    if ("data" in result) {
      dispatch(baseApi.util.resetApiState());
      router.replace(next as Route);
    }
  }

  return (
    <form
      method="post"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-5"
    >
      {sessionNotice && !apiError ? <Alert tone="warning">{sessionNotice}</Alert> : null}
      {apiError ? (
        <Alert tone="danger">
          {apiError.code === "RATE_LIMITED"
            ? "Too many attempts. Please wait a minute and try again."
            : apiError.message}
        </Alert>
      ) : null}
      <FormTextField
        control={control}
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        placeholder="name@hotel.com"
        required
        autoFocus
        controlSize="lg"
      />
      <FormPasswordField
        control={control}
        label="Password"
        name="password"
        autoComplete="current-password"
        placeholder="Enter your password"
        required
        controlSize="lg"
      />
      <Button
        type="submit"
        size="touch"
        pending={isLoading || formState.isSubmitting}
        className="mt-1 w-full"
      >
        Sign in
      </Button>
    </form>
  );
}
