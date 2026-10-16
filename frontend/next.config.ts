import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Arena live preview is served from an e2b.app origin, not localhost.
  // Allow its dev assets/HMR so client-side interactions work in the preview.
  allowedDevOrigins: ["*.e2b.app"],
};

export default nextConfig;
