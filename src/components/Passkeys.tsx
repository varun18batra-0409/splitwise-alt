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

export function PasskeySignIn({ back, className }: { back: string; className: string }) {
  const supported = usePasskeySupport();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
      window.location.assign(`${back}${back.includes("?") ? "&" : "?"}signedin=1`);
    } catch (e) {
      const msg = (e as Error).name === "NotAllowedError" ? "Cancelled. Try again, or use Google or your email." : (e as Error).message;
      setError(msg || "That didn’t work. Try again, or use Google or your email.");
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" onClick={go} disabled={busy} className={className}>
        <FingerprintIcon /> {busy ? "Waiting for your phone…" : "Sign in with fingerprint or face"}
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
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden className="mr-2 inline-block align-[-4px]">
      <path d="M12 11v3a8 8 0 0 0 1 4M8.5 13.5c0-2 1.6-3.5 3.5-3.5s3.5 1.5 3.5 3.5V15M5 12a7 7 0 0 1 14 0v2M7.5 19.5A10 10 0 0 1 6 14M16.5 20c.4-1.3.5-2.6.5-4M4 7.5A9.5 9.5 0 0 1 12 3.5a9.5 9.5 0 0 1 8 4" />
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
        <PasskeyAdd className="flex items-center border border-line px-4 py-2.5 text-sm font-semibold text-fg active:bg-mist" label="Turn it on" onDone={() => setTimeout(hide, 2500)} />
      </div>
      <button type="button" onClick={hide} aria-label="Not now" className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full text-base opacity-60 active:bg-black/10">
        ✕
      </button>
    </section>
  );
}
