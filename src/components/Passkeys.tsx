"use client";

import { useEffect, useState } from "react";
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";

// "Sign in with fingerprint or face" and "Turn on fingerprint / face sign-in".

async function post(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { ok: res.ok, json: await res.json().catch(() => ({})) };
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows computer";
  return "This device";
}

export function usePasskeySupport() {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(browserSupportsWebAuthn()), []);
  return ok;
}

// This phone has used fingerprint / face sign-in before (then the button is
// shown big; otherwise it's a small line, so new people aren't sent down a
// path that can't work for them yet).
const USED_KEY = "lp_pk";
function rememberUsed() {
  try {
    localStorage.setItem(USED_KEY, "1");
  } catch {
    // fine
  }
}

export function PasskeySignIn({ back, className }: { back: string; className: string }) {
  const supported = usePasskeySupport();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [used, setUsed] = useState(false);
  useEffect(() => {
    try {
      setUsed(localStorage.getItem(USED_KEY) === "1");
    } catch {
      // fine
    }
  }, []);
  if (!supported) return null;
  async function go() {
    setBusy(true);
    setError("");
    try {
      const o = await post("/api/passkey/login/options");
      if (!o.ok) throw new Error(o.json.error ?? "Couldn’t start.");
      const response = await startAuthentication({ optionsJSON: o.json });
      const v = await post("/api/passkey/login/verify", { response });
      if (!v.ok) throw new Error(v.json.error ?? "That didn’t work.");
      rememberUsed();
      window.location.assign(`${back}${back.includes("?") ? "&" : "?"}signedin=1`);
    } catch (e) {
      const msg = (e as Error).name === "NotAllowedError" ? "Cancelled. Try again, or use Google or your email." : (e as Error).message;
      setError(msg || "That didn’t work. Try again, or use Google or your email.");
      setBusy(false);
    }
  }
  return (
    <div>
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className={used ? className : "mx-auto block py-2 text-center text-sm text-gray-500 underline underline-offset-4"}
      >
        {used && <FingerprintIcon />} {busy ? "Waiting for your phone…" : "Sign in with fingerprint or face"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}

export function PasskeyAdd({ className, label = "Turn on fingerprint / face sign-in", onDone }: { className: string; label?: string; onDone?: () => void }) {
  const supported = usePasskeySupport();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");
  if (!supported) return null;
  async function go() {
    setState("busy");
    setError("");
    try {
      const o = await post("/api/passkey/register/options");
      if (!o.ok) throw new Error(o.json.error ?? "Couldn’t start.");
      const response = await startRegistration({ optionsJSON: o.json });
      const v = await post("/api/passkey/register/verify", { response, label: deviceLabel() });
      if (!v.ok) throw new Error("That didn’t work. Try again.");
      setState("done");
      rememberUsed();
      if (onDone) onDone();
      else window.location.reload();
    } catch (e) {
      const err = e as Error;
      setError(err.name === "InvalidStateError" ? "This phone is already set up." : err.name === "NotAllowedError" ? "Cancelled." : err.message || "That didn’t work. Try again.");
      setState("idle");
    }
  }
  if (state === "done") return <p className="text-sm text-owed">✓ Done. Next time, sign in with your fingerprint or face.</p>;
  return (
    <div>
      <button type="button" onClick={go} disabled={state === "busy"} className={className}>
        <FingerprintIcon /> {state === "busy" ? "Waiting for your phone…" : label}
      </button>
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}

function FingerprintIcon() {
  return (
    // A scan frame with a fingerprint inside: reads as "your phone's fingerprint or face".
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mr-2 inline-block align-[-4px]">
      <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
      <path d="M7.5 13a4.5 4.5 0 0 1 9 0M9.5 16.5V13a2.5 2.5 0 0 1 5 0v3.5M12 13v4.5M7.5 13v2M16.5 13v1" />
    </svg>
  );
}

// Right after signing in, once: "Sign in faster next time?"
export function PasskeyOffer() {
  const supported = usePasskeySupport();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("hide:passkey-offer") === "1") setHidden(true);
    } catch {
      // fine
    }
  }, []);
  if (!supported || hidden) return null;
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem("hide:passkey-offer", "1");
    } catch {
      // fine
    }
  };
  return (
    <section className="relative mb-4 rounded-2xl border border-line px-4 py-4 pr-10">
      <p className="font-semibold">Sign in faster next time?</p>
      <p className="mt-1 text-sm text-gray-500">Use your fingerprint or face instead of a code. It stays on your phone.</p>
      <div className="mt-3">
        <PasskeyAdd className="flex items-center border border-line px-4 py-2.5 text-sm font-semibold text-fg active:bg-mist rounded-full" label="Turn it on" onDone={() => setTimeout(hide, 2500)} />
      </div>
      <button type="button" onClick={hide} aria-label="Not now" className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full text-base opacity-60 active:bg-black/10">
        ✕
      </button>
    </section>
  );
}
