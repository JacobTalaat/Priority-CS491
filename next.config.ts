import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "us.v-cdn.net",
        pathname: "/6038536/uploads/migrated/**",
      },
    ],
  },
};

export default nextConfig;
