import type { NextConfig } from "next";

/** @type {import('next').NextConfig} */
const target = process.env.API_PROXY_TARGET || "http://localhost:8000";
const nextConfig: NextConfig = {
  // Unit-test fixtures are checked/run separately; compile the shipped app here.
  typescript: { tsconfigPath: "tsconfig.build.json" },
  // Backstop: Next's rewrite proxy defaults to 30s and 499s Regenerates.
  experimental: { proxyTimeout: 600_000 },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${target}/api/:path*` }];
  },
  // RunPod Cloudflare proxy caches prerendered HTML with s-maxage=31536000.
  // That trapped users on a pre-Engine /create shell after deploys. Send
  // explicit CDN no-store so edge does not keep year-long HTML HITs.
  async headers() {
    return [
      {
        source: "/((?!_next/static|_next/image|favicon.ico).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-cache, no-store, max-age=0, must-revalidate",
          },
          { key: "CDN-Cache-Control", value: "no-store" },
          { key: "Cloudflare-CDN-Cache-Control", value: "no-store" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
    ];
  },
};

export default nextConfig;
