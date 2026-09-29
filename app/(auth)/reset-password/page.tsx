import type { Metadata } from "next";
import { ResetPasswordForm } from "./components/ResetPasswordForm";

export const metadata: Metadata = { title: "Set a new password" };

/**
 * One-time reset link target. The token is in the URL fragment, which the
 * browser never sends to the server; the form reads it client-side.
 */
export default function ResetPasswordPage() {
  return (
    <section>
      <p className="hidden text-2xs font-semibold tracking-[0.16em] text-brand uppercase lg:block">
        SERENE MANAGEMENT
      </p>
      <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.025em] lg:mt-2">
        Set a new password
      </h1>
      <p className="mt-1.5 mb-8 text-sm text-fg-secondary">
        This link works once and expires 30 minutes after it was issued.
      </p>
      <ResetPasswordForm />
    </section>
  );
}
