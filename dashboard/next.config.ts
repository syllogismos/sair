import type { NextConfig } from "next";

const allowedOrigins = process.env.ALLOWED_DEV_ORIGINS
  ? process.env.ALLOWED_DEV_ORIGINS.split(",").map((s) => s.trim())
  : [];

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  ...(allowedOrigins.length > 0 && { allowedDevOrigins: allowedOrigins }),
};

export default nextConfig;
