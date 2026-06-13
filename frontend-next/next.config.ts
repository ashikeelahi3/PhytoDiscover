import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        // destination: "http://localhost:8000/api/:path*",
        destination: "http://103.99.177.82:3000/ws/:path*",
      },
      {
        source: "/ws/:path*",
        // destination: "http://localhost:8000/ws/:path*",
        destination: "http://103.99.177.82:3000/ws/:path*",

      },
    ];
  },
};

export default nextConfig;
