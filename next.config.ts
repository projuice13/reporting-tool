import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Nothing special needed. Server route talks to WooCommerce; secrets stay
  // server-side via environment variables.
};

export default nextConfig;
