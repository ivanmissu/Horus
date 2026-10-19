import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel owns its deployment output; standalone is for Docker/self-hosting.
  ...(process.env.VERCEL === "1" ? {} : { output: "standalone" as const }),
  env: {
    NEXT_PUBLIC_HORUS_SCHEDULED_DIGEST_AVAILABLE: process.env.VERCEL === "1" ? "false" : "true",
  },
  serverExternalPackages: ["mysql2", "pg"],
  // The Arena live preview is served from an e2b.app origin, not localhost.
  // Allow its dev assets/HMR so client-side interactions work in the preview.
  allowedDevOrigins: ["*.e2b.app"],
};

export default nextConfig;
