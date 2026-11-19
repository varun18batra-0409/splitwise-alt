// Loopin service worker: lets the app be installed, shows phone
// notifications and opens the right group when one is tapped. If the phone is
// offline it shows a short message instead of the browser's error page.
// TRIAL (branch phase-offline-trial): also keeps one generic offline screen (/offline-app) and its script and style files,
// and sends group pages there when the phone has no signal.
const SHELL = "/offline-app";
const PREFIX = "loopin-shell-";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(saveShell().catch(() => {})); // never stops the install
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
  if (event.data === "save-shell") event.waitUntil(saveShell().catch(() => {}));
});

// Fetch the offline screen with no cookies, then the files it lists, into a NEW cache; the older one goes only after it is complete.
async function saveShell() {
  const res = await fetch(SHELL, { credentials: "omit", cache: "no-store" });
  if (!res.ok) throw new Error("shell " + res.status);
  const html = await res.clone().text();
  const files = new Set();
  for (const m of html.matchAll(/(?:\/_next\/)?static\/(?:chunks|css|media)\/[^"'\\\s<>)]+/g)) {
    files.add(m[0].startsWith("/_next/") ? m[0] : "/_next/" + m[0]);
  }
  const name = PREFIX + Date.now();
  const cache = await caches.open(name);
  try {
    await cache.put(SHELL, res);
    await Promise.all([...files].map(async (f) => {
      const r = await fetch(f, { credentials: "omit" });
      if (r.ok) await cache.put(f, r);
    }));
  } catch (e) {
    await caches.delete(name).catch(() => {});
    throw e;
  }
  for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== name) await caches.delete(k);
}
async function newest() {
  const ks = (await caches.keys()).filter((k) => k.startsWith(PREFIX)).sort();
  return ks[ks.length - 1] || "";
}
async function saved(req) {
  const name = await newest();
  if (!name) return undefined;
  return (await caches.open(name)).match(req, { ignoreSearch: req === SHELL });
}

const OFFLINE_MESSAGE =
  '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#0d0d0f;color:#f4f2ec;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><p style="font-size:22px;font-weight:600">You’re offline</p><p style="color:#9a978f">Loopin needs the internet. Check your connection and try again.</p></div>';

// Where a failed page load goes instead (or "" for today's plain message).
function offlineTarget(path) {
  let m = /^\/groups\/([^/]+)\/add\/?$/.exec(path);
  if (m && m[1] !== "new") return SHELL + "?g=" + m[1] + "&s=add";
  m = /^\/groups\/([^/]+)(?:\/.*)?$/.exec(path);
  if (m && m[1] !== "new") return SHELL + "?g=" + m[1];
  if (path === "/" || path === "/groups") return SHELL;
  return "";
}

async function page(req, url) {
  try {
    return await fetch(req);
  } catch (err) {
    if (url.pathname === SHELL) {
      const hit = await saved(SHELL).catch(() => undefined);
      if (hit) return hit;
    } else {
      const to = offlineTarget(url.pathname);
      if (to && (await saved(SHELL).catch(() => undefined))) return Response.redirect(new URL(to, self.location.origin).href, 302);
    }
    return new Response(OFFLINE_MESSAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

self.addEventListener("fetch", (event) => {
  try {
    const req = event.request;
    if (req.method !== "GET") return; // everything else goes straight to the network
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    if (req.mode === "navigate") event.respondWith(page(req, url));
    else if (url.pathname.startsWith("/_next/static/")) {
      // Script and style files: the network first; the saved copy only when it fails.
      event.respondWith(fetch(req).catch(async () => (await saved(req).catch(() => undefined)) || Response.error()));
    }
  } catch {
    /* anything unexpected: the browser goes to the network as if there were no service worker */
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Loopin", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Loopin";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || undefined,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
