"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// TRIAL ONLY (branch phase-offline-trial). A generic offline screen: loads nothing from the server, shows nothing personal.
// It reads one test value from this phone's IndexedDB and checks for a signal with /api/ping.
const DB = "loopin-offline-trial";

function readValue(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore("kv");
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const get = open.result.transaction("kv").objectStore("kv").get("test");
        get.onsuccess = () => resolve(typeof get.result === "string" ? get.result : null);
        get.onerror = () => resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

export default function OfflineApp() {
  const [value, setValue] = useState<string | null | undefined>(undefined);
  const [net, setNet] = useState<"checking" | "offline" | "online" | "back">("checking");
  const [where, setWhere] = useState("");

  useEffect(() => {
    setWhere(window.location.search);
    void readValue().then(setValue);
    let was = false;
    const check = async () => {
      try {
        const r = await fetch("/api/ping", { cache: "no-store", signal: AbortSignal.timeout(5000) });
        if (!r.ok) throw new Error("bad");
        setNet(was ? "back" : "online");
      } catch {
        was = true;
        setNet("offline");
      }
    };
    void check();
    const t = setInterval(check, 3000);
    window.addEventListener("online", check);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", check);
    };
  }, []);

  const g = new URLSearchParams(where).get("g");
  return (
    <section data-offline-app className="py-10">
      <h1 className="font-display text-2xl font-semibold">Offline trial</h1>
      <p data-offline-value className="mt-3">{value === undefined ? "loading" : (value ?? "none")}</p>
      <p data-offline-where className="mt-1 text-sm text-gray-500">{where || "(no query)"}</p>
      <p data-offline-net className="mt-3 font-medium">
        {net === "checking" ? "Checking" : net === "offline" ? "You’re offline" : net === "back" ? "Back online" : "Online"}
      </p>
      {g && (
        <Link href={`/groups/${g}`} data-offline-link className="mt-4 block underline">
          Open group
        </Link>
      )}
    </section>
  );
}
