import type { NextConfig } from "next";

/**
 * The browser always calls `/api/v1/*` on the web origin. When the API is real
 * (NEXT_PUBLIC_API_MOCK=0), the Route Handler at `src/app/api/v1/[...path]/route.ts`
 * proxies those calls to the NestJS API while preserving `Set-Cookie` (`lb_rt`)
 * as a first-party cookie (docs/ARCHITECTURE.md).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    unoptimized: true,
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
