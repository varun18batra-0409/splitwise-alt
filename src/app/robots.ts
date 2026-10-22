import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// What search engines may read: the public pages only. People's groups,
// sign-in, invites and the app's own screens stay out of search.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/$", "/how-it-works", "/switching", "/faq", "/welcome", "/privacy", "/terms", "/icon", "/apple-icon", "/opengraph-image", "/photos/", "/guide/", "/_next/static/", "/_next/image"],
        disallow: ["/groups", "/join", "/api", "/account", "/signin", "/search", "/settle", "/notifications", "/add", "/import", "/stats", "/splash", "/private", "/c/", "/collect"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
