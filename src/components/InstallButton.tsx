"use client";

import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// "Install app" — only shows when the phone's browser offers it (Chrome on
// Android), and disappears once installed or when already opened as the app.
export function InstallButton() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    // iPhone/iPad have no install prompt: show how to add it by hand.
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const installed =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIosHint(ios && !installed);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!prompt && iosHint) {
    return (
      <div className="mt-10 flex items-center gap-3 border border-line px-4 py-3 text-sm">
        <span className="text-xl" aria-hidden>
          ⬆︎
        </span>
        <span>
          <span className="block font-medium text-fg">Put Loopin on your Home Screen</span>
          <span className="block text-xs text-gray-400">
            In Safari tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. It opens like an app.
          </span>
        </span>
      </div>
    );
  }
  if (!prompt) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        await prompt.prompt();
        await prompt.userChoice;
        setPrompt(null);
      }}
      className="mt-10 flex w-full items-center justify-between border border-line px-4 py-3 text-left text-sm active:bg-mist"
    >
      <span>
        <span className="block font-medium text-fg">Install Loopin on this phone</span>
        <span className="block text-xs text-gray-400">Opens like an app, from your home screen</span>
      </span>
      <span className="text-gray-400">Install</span>
    </button>
  );
}
