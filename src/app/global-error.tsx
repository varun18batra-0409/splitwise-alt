"use client";

// Last resort, when even the app's frame couldn't be shown: a plain page in
// Loopin's colours with a way back.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0d0d0f", color: "#f4f2ec", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
          <div>
            <p style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Loopin didn’t load</p>
            <p style={{ color: "#9d9a92", fontSize: 14, marginTop: 8 }}>Check your connection and try again. Nothing you saved is lost.</p>
            <button
              type="button"
              onClick={() => reset()}
              style={{ marginTop: 24, background: "#f4f2ec", color: "#0d0d0f", border: 0, padding: "14px 28px", fontWeight: 600, fontSize: 16 }}
            >
              Try again
            </button>
            <p style={{ marginTop: 16 }}>
              <a href="/" style={{ color: "#f4f2ec" }}>
                Go to Home
              </a>
            </p>
          </div>
        </main>
      </body>
    </html>
  );
}
