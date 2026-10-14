import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Split",
  description: "Split bills with friends",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <main className="mx-auto min-h-dvh max-w-md px-5 pb-32 pt-6">{children}</main>
      </body>
    </html>
  );
}
