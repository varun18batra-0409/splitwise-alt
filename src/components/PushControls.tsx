"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { clearResyncCookieString, pushSyncPlan } from "@/lib/push-resync";
import { BellIcon } from "./DrawnIcons";
import { phoneStatusLabel, type PhoneState } from "@/lib/phone-status";
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

type State = PhoneState;

// "This phone": whether THIS phone lets Loopin send notifications at all, and the switch for it.
// (What Loopin chooses to send is separate: see the "What Loopin sends" row and each group’s settings.)
export function PhoneStatus({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<State>("checking");
  const [permission, setPermission] = useState<"default" | "granted" | "denied" | "none">("none");
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
    if (!supported()) {
      setState(typeof navigator !== "undefined" && isIOS() && !isInstalled() ? "ios-install" : "unsupported");
      return;
    }
    if (isIOS() && !isInstalled()) return setState("ios-install");
    if (Notification.permission === "denied") return setState("denied");
    // Without permission there can't be a working subscription, so there's nothing to look up.
    if (Notification.permission !== "granted") return setState("off");
    // Only look (never register here: the app registers its worker once elsewhere), and never wait more than
    // 3 s: a browser whose push service doesn't answer must not leave this page stuck on "checking".
    let done = false;
    // Only ever replaces "checking": a late answer must not undo what a tap has started since.
    // (A slow answer after the 3 s fallback may still correct "off", but never a state a tap has started.)
    let timedOut = false;
    const settle = (next: State) => setState((now) => (now === "checking" || (timedOut && now === "off") ? next : now));
    const giveUp = setTimeout(() => {
      if (!done) {
        settle("off");
        timedOut = true;
      }
    }, 3000);
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => (reg ? reg.pushManager.getSubscription() : null))
      .then((sub) => {
        done = true;
        settle(sub ? "on" : "off");
      })
      .catch(() => {
        done = true;
        settle("off");
      })
      .finally(() => clearTimeout(giveUp));
    return () => clearTimeout(giveUp);
  }, []);

  async function turnOn() {
    setError("");
    setState("working");
    try {
      const answer = await Notification.requestPermission();
      setPermission(answer);
      if (answer !== "granted") return setState(answer === "denied" ? "denied" : "off");
      const { reg } = await currentSubscription();
      const key = await pushPublicKey();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const res = await savePushSubscription(json);
      if (res.unsupported) {
        setError("This browser's notification service isn't supported. Try Chrome, Safari, Firefox or Edge.");
        setState("off");
        return;
      }
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
  const label = phoneStatusLabel(state, permission);
  return (
    <section className={compact ? "rounded-2xl border border-line p-4" : "mb-4 rounded-2xl border border-line p-4"} data-phone-status>
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#d8bd7a]/45 text-[#e8d29a]">
          <BellIcon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">This phone</p>
          <p className="text-sm text-gray-500" data-phone-state={state}>
            {label}
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
  // Checked again on each page change, so a sign-in that ends with a redirect (no full reload) is still noticed.
  const pathname = usePathname();
  useEffect(() => {
    if (!supported()) return;
    let last = 0;
    try {
      last = Number(localStorage.getItem("lp_push_sync") ?? 0);
    } catch {}
    const plan = pushSyncPlan({ granted: Notification.permission === "granted", cookieHeader: document.cookie, lastSyncMs: last, nowMs: Date.now() });
    if (!plan.run) return;
    const t = window.setTimeout(() => {
      currentSubscription()
        .then(async ({ sub }) => {
          if (!sub) {
            // Allowed but not subscribed: nothing to put back, so the note is cleared rather than re-run on every page.
            if (plan.resync) document.cookie = clearResyncCookieString();
            return;
          }
          const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
          if (r.ok) {
            if (plan.resync) document.cookie = clearResyncCookieString();
            try {
              localStorage.setItem("lp_push_sync", String(Date.now()));
            } catch {}
          }
        })
        .catch(() => {});
    }, plan.resync ? 500 : 4000);
    return () => window.clearTimeout(t);
  }, [pathname]);
  return null;
}
