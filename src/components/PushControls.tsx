"use client";

import { useEffect, useState } from "react";
import { BellIcon } from "./Icons";
import { pushPublicKey, removePushSubscription, savePushSubscription } from "@/app/actions";

// Turning phone notifications on and off, and keeping them working when
// this phone joins more groups.

function supported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
function keyBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function currentSubscription() {
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  return { reg, sub: await reg.pushManager.getSubscription() };
}

type State = "checking" | "unsupported" | "ios-install" | "denied" | "off" | "on" | "working";

export function PushToggle() {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supported()) {
      setState(typeof navigator !== "undefined" && isIOS() && !isInstalled() ? "ios-install" : "unsupported");
      return;
    }
    if (isIOS() && !isInstalled()) return setState("ios-install");
    if (Notification.permission === "denied") return setState("denied");
    currentSubscription()
      .then(({ sub }) => setState(sub && Notification.permission === "granted" ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  async function turnOn() {
    setError("");
    setState("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
      const { reg } = await currentSubscription();
      const key = await pushPublicKey();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const res = await savePushSubscription(json);
      if (!res.ok) throw new Error("save");
      setState("on");
    } catch {
      setError("Couldn't turn notifications on. Try again.");
      setState("off");
    }
  }

  async function turnOff() {
    setState("working");
    try {
      const { sub } = await currentSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
    } catch {
      /* already off */
    }
    setState("off");
  }

  const on = state === "on";
  return (
    <section className="mb-8 rounded-2xl border border-line p-4">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#d8bd7a]/45 text-[#e8d29a]">
          <BellIcon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">Notifications on this phone</p>
          <p className="text-sm text-gray-500">
            {on
              ? "On — you'll get a notification when friends add, change or settle something."
              : "Get a notification when friends add, change or settle something."}
          </p>
        </div>
        {(state === "on" || state === "off" || state === "working") && (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Notifications on this phone"
            disabled={state === "working"}
            onClick={on ? turnOff : turnOn}
            className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-60 ${on ? "bg-owed" : "bg-gray-300"}`}
          >
            <span className={`absolute top-1 h-6 w-6 rounded-full bg-canvas transition-all ${on ? "left-7" : "left-1"}`} />
          </button>
        )}
      </div>
      {state === "ios-install" && (
        <p className="mt-3 rounded-xl bg-mist px-3 py-2.5 text-sm text-gray-600">
          On iPhone, notifications work once Loopin is on your Home Screen: tap <strong className="text-fg">Share ⬆︎</strong> →{" "}
          <strong className="text-fg">Add to Home Screen</strong>, open Loopin from there, and turn this on.
        </p>
      )}
      {state === "denied" && (
        <p className="mt-3 rounded-xl bg-mist px-3 py-2.5 text-sm text-gray-600">
          Notifications are blocked for Loopin. Allow them in your phone’s settings for this app or site, then come back.
        </p>
      )}
      {state === "unsupported" && (
        <p className="mt-3 text-sm text-gray-500">This browser can’t show notifications. Try Chrome on Android or Safari on iPhone.</p>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </section>
  );
}

// When the app opens (at most every 6 hours): if notifications are on, make
// sure groups joined since then are included. A plain request, a few seconds
// after opening, so it never holds up the first taps.
export function PushSync() {
  useEffect(() => {
    if (!supported() || Notification.permission !== "granted") return;
    let last = 0;
    try {
      last = Number(localStorage.getItem("lp_push_sync") ?? 0);
    } catch {}
    if (Date.now() - last < 6 * 3600_000) return;
    const t = window.setTimeout(() => {
      currentSubscription()
        .then(async ({ sub }) => {
          if (!sub) return;
          const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
          if (r.ok)
            try {
              localStorage.setItem("lp_push_sync", String(Date.now()));
            } catch {}
        })
        .catch(() => {});
    }, 4000);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}
