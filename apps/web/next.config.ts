import type { NextConfig } from "next";

/**
 * The browser always calls `/api/v1/*` on the web origin. When the API is real
 * (NEXT_PUBLIC_API_MOCK=0), Next rewrites those calls to the NestJS API so the
 * refresh cookie `lb_rt` stays first-party (docs/ARCHITECTURE.md).
 */
const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:4000";
const useMock = process.env.NEXT_PUBLIC_API_MOCK !== "0";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    if (useMock) return [];
    return [{ source: "/api/v1/:path*", destination: `${apiOrigin}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/service-worker.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
