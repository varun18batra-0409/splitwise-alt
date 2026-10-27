import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";
import { PushSync } from "@/components/PushControls";
import { TimeZoneSync } from "@/components/TimeZoneSync";
import { DoubleTapGuard } from "@/components/DoubleTapGuard";
import { InstallCapture } from "@/components/GetApp";
import { Haptics } from "@/components/Haptics";
import { AppRefresh } from "@/components/AppRefresh";
import { NavProgress } from "@/components/NavProgress";
import { Splash } from "@/components/Splash";
import { MotionWatch } from "@/components/MotionWatch";
import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "@/lib/site";

// Fraunces: a sharp, high-contrast serif for headings and big amounts.
// Both fonts ship with the app
// (src/fonts, SIL Open Font License): fetching them from Google while
// building sometimes failed, and that stopped a release.
const fraunces = localFont({ src: [{ path: "../fonts/fraunces-latin-wght-normal.woff2", weight: "100 900", style: "normal" }], variable: "--font-fraunces", display: "swap" });
// Instrument Sans: the everyday face for text and money (clean, a little warm, made for screens).
const instrument = localFont({ src: [{ path: "../fonts/instrument-sans-latin-wght-normal.woff2", weight: "400 700", style: "normal" }], variable: "--font-instrument", display: "swap" });
// Caveat: a handwritten hand for the captions on polaroid photos (names written under a picture).
const caveat = localFont({
  src: [
    { path: "../fonts/caveat-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../fonts/caveat-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-caveat",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: "%s · Loopin" },
  description: SITE_DESCRIPTION,
  applicationName: "Loopin",
  keywords: ["split expenses", "split bills", "Splitwise alternative", "expense sharing app", "trip expenses", "flatmates", "roommates", "couples budget", "group expenses"],
  openGraph: { type: "website", url: SITE_URL, siteName: "Loopin", title: SITE_TITLE, description: SITE_DESCRIPTION, locale: "en_US" },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
  // Google Search Console's "HTML tag" check, if that way is used (set in the hosting settings).
  verification: process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : undefined,
  appleWebApp: { capable: true, title: "Loopin", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d0d0f",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${caveat.variable} ${instrument.variable}`} suppressHydrationWarning>
      <head>
        {/* Opening the app: the opening screen stays at least 1.5 seconds (and until the app is ready), once per visit. */}
        <script dangerouslySetInnerHTML={{ __html: OPENING }} />
        {/* What Loopin is, for search engines (a free web app on Android and iPhone). */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(APP_INFO) }} />
      </head>
      <body className="antialiased">
        <div className="lp-open" aria-hidden>
          <Splash />
        </div>
        <main className="mx-auto min-h-dvh max-w-md px-5 pb-32 pt-[max(1.5rem,env(safe-area-inset-top))]">{children}</main>
        <BottomNav />
        <PushSync />
        <TimeZoneSync />
        <DoubleTapGuard />
        <InstallCapture />
        <AppRefresh />
        <Haptics />
        <NavProgress />
        <MotionWatch />
      </body>
    </html>
  );
}

// Runs before anything is drawn: on opening the app at Home (not for automated
// test browsers), shows the opening screen, then fades it out once 1.5 seconds
// have passed and the app is ready.
const OPENING = `(function(){try{
var h=document.documentElement;
if(location.pathname!=="/"||navigator.webdriver||sessionStorage.getItem("lp_opened"))return;
sessionStorage.setItem("lp_opened","1");h.classList.add("lp-opening");var t0=Date.now();
function done(){setTimeout(function(){h.classList.add("lp-opened");setTimeout(function(){h.classList.remove("lp-opening","lp-opened")},400)},Math.max(0,1500-(Date.now()-t0)))}
if(document.readyState==="complete")done();else addEventListener("load",done);
setTimeout(done,12000);
}catch(e){}})();`;

const APP_INFO = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Loopin",
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Android, iOS, Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};
