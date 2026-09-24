import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-xs font-semibold tracking-[0.24em] text-brand">
          SERENE MANAGEMENT
        </p>
        {children}
      </div>
    </main>
  );
}
