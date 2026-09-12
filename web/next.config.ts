import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
