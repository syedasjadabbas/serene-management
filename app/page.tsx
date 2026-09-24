/**
 * Phase 0 placeholder. The authenticated workspace and login arrive in
 * Phase 1 (docs/IMPLEMENTATION_ROADMAP.md); until then the root only
 * identifies the build.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-2 px-6">
      <p className="text-xs font-medium tracking-[0.2em] text-fg-muted">SERENE MANAGEMENT</p>
      <h1 className="text-xl font-semibold">Architecture foundation</h1>
      <p className="text-fg-secondary">
        No PMS modules are implemented yet. See <code className="font-mono text-sm">docs/</code> for
        the architecture and roadmap.
      </p>
    </main>
  );
}
