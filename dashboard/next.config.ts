import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: ["192.168.0.69"],
};

export default nextConfig;
