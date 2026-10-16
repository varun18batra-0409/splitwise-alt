import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // The online-database driver uses native code; load it as-is instead of bundling.
  serverExternalPackages: ["@prisma/adapter-libsql", "@libsql/client", "libsql", "nodemailer"],
  experimental: {
    serverActions: {
      // Lets forms work when the app is opened through GitHub Codespaces.
      allowedOrigins: process.env.NODE_ENV === "production" && !process.env.CODESPACES ? [] : ["localhost:3000", "*.app.github.dev"],
    },
  },
};

export default nextConfig;
