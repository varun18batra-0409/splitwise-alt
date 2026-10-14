import type { Metadata, Viewport } from "next";
import { Fraunces } from "next/font/google";
import "./globals.css";
import { AddExpenseButton } from "@/components/AddExpenseButton";

// Fraunces: a sharp, high-contrast serif for headings and big amounts.
// Body text stays in the phone's own font.
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });

export const metadata: Metadata = {
  title: "Barabar",
  description: "Split it. Keep it barabar.",
  applicationName: "Barabar",
  appleWebApp: { capable: true, title: "Barabar", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d0d0f",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fraunces.variable}>
      <body className="antialiased">
        <main className="mx-auto min-h-dvh max-w-md px-5 pb-32 pt-[max(1.5rem,env(safe-area-inset-top))]">{children}</main>
        <AddExpenseButton />
      </body>
    </html>
  );
}
