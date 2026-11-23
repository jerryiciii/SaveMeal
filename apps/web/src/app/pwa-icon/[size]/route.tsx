import { ImageResponse } from "next/og";

const SIZES = new Set([180, 192, 512]);

/**
 * PNG app icons rendered from design tokens (Night + Mint), so no binary icon
 * files live in git. Replace with a designed icon when one exists in Figma.
 */
export async function GET(request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  const maskable = new URL(request.url).searchParams.get("maskable") === "1";
  const inner = maskable ? size * 0.6 : size * 0.78;
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
          borderRadius: maskable ? 0 : size * 0.22,
        }}
      >
        <div
          style={{
            width: inner,
            height: inner,
            borderRadius: inner / 2,
            background: "#65E4B3",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#142E29",
            fontSize: inner * 0.5,
            fontWeight: 800,
          }}
        >
          LB
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
