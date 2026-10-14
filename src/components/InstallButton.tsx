"use client";

import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// "Install app" — only shows when the phone's browser offers it (Chrome on
// Android), and disappears once installed or when already opened as the app.
export function InstallButton() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);

  useEffect(() => {
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
        <span className="block font-medium text-fg">Install Split on this phone</span>
        <span className="block text-xs text-gray-400">Opens like an app, from your home screen</span>
      </span>
      <span className="text-gray-400">Install</span>
    </button>
  );
}
