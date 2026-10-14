import type { Metadata, Viewport } from "next";
import { Sora } from "next/font/google";
import "./globals.css";
import { AddExpenseButton } from "@/components/AddExpenseButton";

// Sora: a geometric face for headings and amounts. Body text stays in the phone's own font.
const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap" });

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
    <html lang="en" className={sora.variable}>
      <body className="antialiased">
        <main className="mx-auto min-h-dvh max-w-md px-5 pb-32 pt-6">{children}</main>
        <AddExpenseButton />
      </body>
    </html>
  );
}
