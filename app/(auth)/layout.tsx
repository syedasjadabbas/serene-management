import type { ReactNode } from "react";
import { SereneLogo } from "@/components/brand/Logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-8 flex justify-center">
          <SereneLogo size="lg" />
        </p>
        {children}
      </div>
    </main>
  );
}
