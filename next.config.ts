import type { NextConfig } from "next";

/**
 * Baseline security headers (docs/ARCHITECTURE.md §Security). A nonce-based
 * Content-Security-Policy is added in proxy.ts in Phase 1, where the nonce can
 * be generated per request.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  // The dev-only route indicator ("Rendering…") overlaps the workspace and
  // lingers after pages settle; navigation feedback comes from the shell's
  // own progress bar. Compile and runtime errors are still surfaced.
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
