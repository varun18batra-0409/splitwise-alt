import type { NextConfig } from "next";

// Browser protections on every response: no other site may show Loopin inside
// a frame, scripts and connections only from Loopin itself, fonts for the
// postcard letterings from Google Fonts, pictures from anywhere over https.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // The online-database driver uses native code; load it as-is instead of bundling.
  serverExternalPackages: ["@prisma/adapter-libsql", "@libsql/client", "libsql", "nodemailer"],
  experimental: {
    // Screens fetched ahead of a tap are kept for 30 seconds at most (and
    // forgotten as soon as anything is saved: see lib/fresh-redirect.ts).
    staleTimes: { dynamic: 0, static: 30 },
    serverActions: {
      // Room for a Splitwise export (up to 2 MB of text) to be brought over in one go.
      bodySizeLimit: "3mb",
      // Lets forms work when the app is opened through GitHub Codespaces.
      allowedOrigins: process.env.NODE_ENV === "production" && !process.env.CODESPACES ? [] : ["localhost:3000", "*.app.github.dev"],
    },
  },
};

export default nextConfig;
