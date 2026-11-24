// Loopin service worker: lets the app be installed, shows phone
// notifications and opens the right group when one is tapped. If the phone is
// offline it shows a short message instead of the browser's error page.
// ADD EXPENSES OFFLINE (switch OFFLINE_ADD): when the app tells this worker the switch is on, it keeps one generic offline screen
// (/offline-app, no personal data) and the script and style files that screen lists, and sends group pages and Home there when the
// phone has no signal. With the switch off (or before the app has said it is on) nothing is kept and nothing is redirected:
// today's plain message shows. A fault in any of this falls back to the network, as if there were no service worker.
const SHELL = "/offline-app";
const PREFIX = "loopin-shell-";
const SIX_HOURS = 6 * 60 * 60 * 1000;

self.addEventListener("install", () => self.skipWaiting()); // nothing is saved here: the app says when (message below)
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
  const d = event.data;
  if (!d || typeof d !== "object") return;
  // { offline: true, build }: keep the offline screen (at most every 6 hours, and again after each release).
  // { offline: false }: the switch is off: forget it.
  if (d.offline === true) event.waitUntil(saveShellIfDue(String(d.build || "")).catch(() => {}));
  else if (d.offline === false) event.waitUntil(forgetShell().catch(() => {}));
});

async function forgetShell() {
  for (const k of await caches.keys()) if (k.startsWith(PREFIX)) await caches.delete(k);
}
async function saveShellIfDue(build) {
  const name = await newest();
  if (name) {
    const meta = await (await caches.open(name)).match("/__meta").catch(() => undefined);
    const m = meta ? await meta.json().catch(() => null) : null;
    if (m && m.build === build && Date.now() - m.at < SIX_HOURS) return;
  }
  await saveShell(build);
}

// Fetch the offline screen with no cookies, then the files it lists, into a NEW cache; the older one goes only after it is complete.
async function saveShell(build) {
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
      // Any listed file that did not come back whole fails the whole save (the catch below drops the new cache): the older complete copy stays.
      if (!r.ok) throw new Error("file " + f + " " + r.status);
      await cache.put(f, r);
    }));
    // The marker goes in LAST: a copy without it is half-saved and is never used.
    await cache.put("/__meta", new Response(JSON.stringify({ build, at: Date.now() }), { headers: { "Content-Type": "application/json" } }));
  } catch (e) {
    await caches.delete(name).catch(() => {});
    throw e;
  }
  for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== name) await caches.delete(k);
}
async function newest() {
  const ks = (await caches.keys()).filter((k) => k.startsWith(PREFIX)).sort().reverse();
  for (const k of ks) if (await (await caches.open(k)).match("/__meta").catch(() => undefined)) return k; // newest COMPLETE copy only
  return "";
}
async function saved(req) {
  const name = await newest();
  if (!name) return undefined;
  return (await caches.open(name)).match(req, { ignoreSearch: req === SHELL });
}

// The plain offline page, in Loopin's own look (dark, off-white, Fraunces-style serif for the heading, one cream button): no connection and no saved
// offline screen. It has no outside files, so it always draws. "Try again" reloads the page the person was on.
const OFFLINE_MESSAGE =
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Loopin</title>' +
  '<body style="margin:0;min-height:100vh;background:#0d0d0f;color:#f4f2ec;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box">' +
  '<main style="max-width:320px">' +
  '<p style="margin:0 0 28px;font-family:Georgia,ui-serif,serif;font-size:26px;font-weight:600;letter-spacing:-0.01em">loopin</p>' +
  '<div style="background:#16161a;border:1px solid #26262c;border-radius:24px;padding:32px 24px">' +
  '<h1 style="margin:0;font-family:Georgia,ui-serif,serif;font-size:26px;font-weight:600;line-height:1.15">You’re offline</h1>' +
  '<p style="margin:12px 0 24px;color:#a8a59d;font-size:16px;line-height:1.45">Loopin needs the internet. Check your connection and try again.</p>' +
  '<button type="button" onclick="location.reload()" style="width:100%;height:52px;border:0;border-radius:999px;background:#f4f2ec;color:#0d0d0f;font-size:17px;font-weight:600;font-family:inherit;cursor:pointer">Try again</button>' +
  '</div></main></body></html>';

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
