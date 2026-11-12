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
  // Shared workspace package ships TypeScript source (shared/package.json exports ./*.ts).
  transpilePackages: ["@serene/shared"],
  typedRoutes: true,
  // The dev-only route indicator ("Rendering…") overlaps the workspace and
  // lingers after pages settle; navigation feedback comes from the shell's
  // own progress bar. Compile and runtime errors are still surfaced.
  devIndicators: false,
  // LAN testing from another laptop: `next dev` blocks its dev-only resources (HMR) for
  // any other hostname, so the page never hydrates. Development only; ignored by builds.
  // Any address on the home/office network (192.168.x.y), so a new DHCP lease
  // on this PC does not silently stop the LAN laptop's pages from hydrating.
  // Next matches it label by label from the right, so it accepts only the
  // literal IPv4 form, never a rebinding name like 192.168.18.92.evil.example;
  allowedDevOrigins: ["192.168.*.*"],
  experimental: {
    // Development only. A cold compile on each `next dev` start always matches the
    // files on disk (Turbopack's on-disk dev cache once served a stale route table).
    turbopackFileSystemCacheForDev: false,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
