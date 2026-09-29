import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { getServerSession } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/auth/redirect";
import { LoginForm } from "./components/LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  if (await getServerSession()) redirect(next as Route);

  return (
    <section>
      <p className="hidden text-2xs font-semibold tracking-[0.16em] text-brand uppercase lg:block">
        SERENE MANAGEMENT
      </p>
      <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.025em] lg:mt-2">
        Welcome back
      </h1>
      <p className="mt-1.5 mb-8 text-sm text-fg-secondary">
        Sign in with your hotel staff account to continue.
      </p>
      <LoginForm next={next} />
      <p className="mt-8 border-t border-border-subtle pt-5 text-xs text-fg-muted">
        For SERENE hotel staff only. You see the properties and actions your role allows.
      </p>
    </section>
  );
}
