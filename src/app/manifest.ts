import type { MetadataRoute } from "next";

// Lets phones install the app ("Add to Home screen"): its own icon, and it
// opens full-screen without the browser bar.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Loopin",
    short_name: "Loopin",
    description: "Everyone’s in. Everything adds up.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0d0d0f",
    theme_color: "#0d0d0f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
