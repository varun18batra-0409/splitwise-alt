"use client";

import { useEffect, useState } from "react";

// A hidden field with this phone's notification address, so signing out can
// stop this phone getting the group's notifications too.
export function PushEndpointField() {
  const [endpoint, setEndpoint] = useState("");
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (!("serviceWorker" in navigator)) return;
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (live && sub) setEndpoint(sub.endpoint);
      } catch {
        // No notifications on this phone: nothing to send.
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return <input type="hidden" name="endpoint" value={endpoint} />;
}
