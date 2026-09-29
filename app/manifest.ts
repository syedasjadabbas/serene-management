import type { MetadataRoute } from "next";

/** Web app manifest: lets the app be installed and opened like a desktop app at the front desk. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SERENE MANAGEMENT",
    short_name: "SERENE",
    description: "Hotel property management system",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#107c41",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
