import { BrandLoader } from "@/global/components/brand/BrandLoader";

/** Full-screen transitional state while the session is restored or the redirect happens. */
export function SessionLoader({
  title = "Restoring your session",
  description = "Just a moment while we sign you back in securely.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <BrandLoader title={title} description={description} heading={1} />
    </main>
  );
}
