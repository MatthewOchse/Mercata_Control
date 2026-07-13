import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["argon2", "pdfkit", "sharp"],
};

export default nextConfig;
