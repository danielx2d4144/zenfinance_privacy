import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The SDK ships in @lending/sdk-ts via a workspace symlink; Webpack
  // needs an explicit transpilePackages entry to pick it up.
  transpilePackages: ["@lending/sdk-ts"],
};

export default nextConfig;
