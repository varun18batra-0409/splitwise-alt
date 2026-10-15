"use client";

import { useEffect, useState } from "react";

// "Get the app": Loopin installs from the browser onto the home screen (no app
// store). Android Chrome can install with one tap; iPhone needs Share → Add to
// Home Screen, so we show those steps. Hidden once it's opened as the app.

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
declare global {
  interface Window {
    __loopinInstall?: InstallPrompt | null;
  }
}

// Mounted once (in the layout): registers the service worker (needed for
// installing and for notifications) and keeps the browser's install offer.
export function InstallCapture() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const onPrompt = (e: Event) => {
      e.preventDefault();
      window.__loopinInstall = e as InstallPrompt;
      window.dispatchEvent(new Event("loopin-install"));
    };
    const onInstalled = () => {
      window.__loopinInstall = null;
      window.dispatchEvent(new Event("loopin-install"));
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}

type Platform = "ios-safari" | "ios-other" | "android" | "other";

function useInstall() {
  const [installed, setInstalled] = useState(true); // assume installed until we know (avoids a flash)
  const [platform, setPlatform] = useState<Platform>("other");
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setPlatform(ios ? (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? "ios-other" : "ios-safari") : /Android/.test(ua) ? "android" : "other");
    setInstalled(window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    const sync = () => setPrompt(window.__loopinInstall ?? null);
    sync();
    window.addEventListener("loopin-install", sync);
    return () => window.removeEventListener("loopin-install", sync);
  }, []);
  return { installed, platform, prompt };
}

// The steps for this phone, shown in a sheet.
function Steps({ platform, onClose }: { platform: Platform; onClose: () => void }) {
  const steps =
    platform === "ios-safari"
      ? ["Tap the Share button ⬆︎ at the bottom of Safari.", "Scroll down and tap “Add to Home Screen”.", "Tap “Add”. Loopin is now on your home screen."]
      : platform === "ios-other"
        ? ["Tap the Share button ⬆︎ (next to the address bar).", "Tap “Add to Home Screen”. (On older iPhones, open this page in Safari first.)", "Tap “Add”."]
        : platform === "android"
          ? ["Tap the ⋮ menu at the top right of Chrome.", "Tap “Install app” or “Add to Home screen”.", "Tap “Install”."]
          : ["Open your browser's menu.", "Choose “Install app” or “Add to Home screen”.", "Confirm."];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" role="dialog" aria-modal="true" aria-label="Get the app" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-[24px] border-t border-line bg-canvas px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6" onClick={(e) => e.stopPropagation()}>
        <p className="font-display text-xl font-semibold">Put Loopin on your home screen</p>
        <p className="mt-1 text-sm text-gray-500">No app store needed. It opens full-screen, like any app.</p>
        <ol className="mt-5 space-y-3">
          {steps.map((s, i) => (
            <li key={s} className="flex gap-3 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fg text-xs font-semibold text-canvas">{i + 1}</span>
              <span className="pt-0.5 text-fg">{s}</span>
            </li>
          ))}
        </ol>
        <button type="button" onClick={onClose} className="mt-6 block w-full border border-line py-3 text-sm font-medium text-fg active:bg-mist">
          Got it
        </button>
      </div>
    </div>
  );
}

// A button that installs (Android) or shows the steps (iPhone / others).
export function GetAppButton({ variant = "icon", className = "" }: { variant?: "icon" | "card" | "banner"; className?: string }) {
  const { installed, platform, prompt } = useInstall();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      if (variant === "banner" && localStorage.getItem("loopin-getapp-hidden") === "1") setHidden(true);
    } catch {
      /* ignore */
    }
  }, [variant]);
  if (installed || hidden) return null;

  const go = async () => {
    if (prompt) {
      await prompt.prompt();
      await prompt.userChoice.catch(() => null);
      window.__loopinInstall = null;
      window.dispatchEvent(new Event("loopin-install"));
    } else setOpen(true);
  };
  const sheet = open && <Steps platform={platform} onClose={() => setOpen(false)} />;

  if (variant === "icon") {
    return (
      <>
        <button
          type="button"
          onClick={go}
          aria-label="Get the app"
          className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-sm font-medium text-fg active:bg-mist ${className}`}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 4v11" />
            <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
            <path d="M5 19.5h14" />
          </svg>
          App
        </button>
        {sheet}
      </>
    );
  }
  return (
    <>
      <div className={`flex items-center gap-3 rounded-2xl border border-line px-4 py-3.5 ${className}`}>
        <img src="/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-xl border border-line" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Get the Loopin app</span>
          <span className="block text-xs text-gray-400">Free · on your home screen in seconds</span>
        </span>
        <button type="button" onClick={go} className="pop shrink-0 bg-fg px-4 py-2 text-sm font-semibold text-canvas [--pop-edge:#6e6b63]">
          {prompt ? "Install" : "Get it"}
        </button>
        {variant === "banner" && (
          <button
            type="button"
            aria-label="Not now"
            onClick={() => {
              setHidden(true);
              try {
                localStorage.setItem("loopin-getapp-hidden", "1");
              } catch {
                /* ignore */
              }
            }}
            className="-mr-1 shrink-0 px-1 text-lg leading-none text-gray-400"
          >
            ×
          </button>
        )}
      </div>
      {sheet}
    </>
  );
}
