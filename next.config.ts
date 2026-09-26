import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/cases/[slug]": ["./prisma/*.db", "./.data/repositories/**"],
    "/api/**/*": ["./prisma/*.db", "./.data/repositories/**"],
  },
};

export default nextConfig;
