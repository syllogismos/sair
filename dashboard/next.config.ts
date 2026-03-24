import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: ["100.74.54.34", "192.168.0.69"],
};

export default nextConfig;
