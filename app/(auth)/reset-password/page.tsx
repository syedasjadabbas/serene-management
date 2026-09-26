import type { Metadata } from "next";
import { ResetPasswordForm } from "./components/ResetPasswordForm";

export const metadata: Metadata = { title: "Set a new password" };

/**
 * One-time reset link target. The token is in the URL fragment, which the
 * browser never sends to the server; the form reads it client-side.
 */
export default function ResetPasswordPage() {
  return (
    <section className="rounded-lg border border-border-subtle bg-surface p-6 shadow-raised">
      <h1 className="text-lg font-semibold">Set a new password</h1>
      <p className="mt-1 mb-5 text-sm text-fg-secondary">
        This link works once and expires 30 minutes after it was issued.
      </p>
      <ResetPasswordForm />
    </section>
  );
}
