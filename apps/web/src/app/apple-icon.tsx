import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS home-screen icon (same mark as /pwa-icon). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#111922",
        }}
      >
        <div
          style={{
            width: 140,
            height: 140,
            borderRadius: 70,
            background: "#65E4B3",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#142E29",
            fontSize: 70,
            fontWeight: 800,
          }}
        >
          SM
        </div>
      </div>
    ),
    size,
  );
}
