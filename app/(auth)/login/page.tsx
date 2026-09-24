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
    <section className="rounded-lg border border-border-subtle bg-surface p-6 shadow-raised">
      <h1 className="text-lg font-semibold">Sign in</h1>
      <p className="mt-1 mb-5 text-sm text-fg-secondary">Use your hotel staff account.</p>
      <LoginForm next={next} />
    </section>
  );
}
