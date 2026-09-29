import type { ReactNode } from "react";

/**
 * Full-screen transitional pages (session restore). Unlike the sign-in
 * layout there is no static logo: the page's BrandLoader is the brand.
 */
export default function SessionLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      {children}
    </main>
  );
}
