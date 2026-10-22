import { ImageResponse } from "next/og";

// The picture shown when a Loopin link is shared (WhatsApp, iMessage, X, search
// results): the ring with its green arc, the name and what it does.
export const alt = "Loopin — split expenses with friends, flatmates and couples";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: "0 90px",
          background: "radial-gradient(80% 90% at 85% 20%, #3a2a1e 0%, #121014 70%)",
          color: "#f4f2ec",
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontSize: 108, fontWeight: 700, letterSpacing: -3 }}>loopin</div>
          <div style={{ fontSize: 44, marginTop: 18, color: "#e8e3d8" }}>Split trips, flats & couple life.</div>
          <div style={{ fontSize: 30, marginTop: 26, color: "#9d9a92", fontFamily: "sans-serif" }}>Free · no ads · any currency · Android & iPhone</div>
        </div>
        <div style={{ position: "relative", width: 300, height: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="300" height="300" viewBox="0 0 120 120" style={{ position: "absolute", top: 0, left: 0 }}>
            <circle cx="60" cy="60" r="44" fill="none" stroke="#2b2b31" strokeWidth="11" />
            <circle cx="60" cy="60" r="44" fill="none" stroke="#6fe3a8" strokeWidth="11" strokeLinecap="round" strokeDasharray="70 300" transform="rotate(-30 60 60)" />
          </svg>
          <div style={{ fontSize: 130, fontWeight: 700, color: "#f4f2ec", fontFamily: "Georgia, serif" }}>L</div>
        </div>
      </div>
    ),
    size,
  );
}
