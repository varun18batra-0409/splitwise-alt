import type { Metadata, Viewport } from "next";
import { Fraunces } from "next/font/google";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";
import { PushSync } from "@/components/PushControls";
import { TimeZoneSync } from "@/components/TimeZoneSync";
import { DoubleTapGuard } from "@/components/DoubleTapGuard";
import { InstallCapture } from "@/components/GetApp";
import { AppRefresh } from "@/components/AppRefresh";
import { NavProgress } from "@/components/NavProgress";
import { Splash } from "@/components/Splash";

// Fraunces: a sharp, high-contrast serif for headings and big amounts.
// Body text stays in the phone's own font.
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });

export const metadata: Metadata = {
  title: "Loopin",
  description: "Everyone’s in. Everything adds up.",
  applicationName: "Loopin",
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
    <html lang="en" className={fraunces.variable} suppressHydrationWarning>
      <head>
        {/* Opening the app: the opening screen stays at least 3 seconds (and until the app is ready), once per visit. */}
        <script dangerouslySetInnerHTML={{ __html: OPENING }} />
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
        <NavProgress />
      </body>
    </html>
  );
}

// Runs before anything is drawn: on opening the app at Home (not for automated
// test browsers), shows the opening screen, then fades it out once 3 seconds
// have passed and the app is ready.
const OPENING = `(function(){try{
var h=document.documentElement;
if(location.pathname!=="/"||navigator.webdriver||sessionStorage.getItem("lp_opened"))return;
sessionStorage.setItem("lp_opened","1");h.classList.add("lp-opening");var t0=Date.now();
function done(){setTimeout(function(){h.classList.add("lp-opened");setTimeout(function(){h.classList.remove("lp-opening","lp-opened")},400)},Math.max(0,3000-(Date.now()-t0)))}
if(document.readyState==="complete")done();else addEventListener("load",done);
setTimeout(done,12000);
}catch(e){}})();`;
