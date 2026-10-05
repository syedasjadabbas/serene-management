"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { type FormEvent, useState } from "react";
import { useDispatch } from "react-redux";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { PasswordField } from "@/components/ui/PasswordField";
import { TextField } from "@/components/ui/TextField";
import { baseApi } from "@/lib/api/baseApi";
import { useLoginMutation } from "@/lib/api/endpoints/session.api";
import { toClientApiError } from "@/lib/api/errors";
import { loginSchema } from "@/modules/identity/identity.schema";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const dispatch = useDispatch();
  const [login, { isLoading, error }] = useLoginMutation();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const apiError = toClientApiError(error);

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
      router.refresh();
    }
  }

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
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
