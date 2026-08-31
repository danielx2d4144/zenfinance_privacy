import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The SDK ships in @lending/sdk-ts via a workspace symlink; Webpack
  // needs an explicit transpilePackages entry to pick it up.
  transpilePackages: ["@lending/sdk-ts"],

  webpack: (config) => {
    // Externalize @x402 packages that are optional peer deps of @coinbase/cdp-sdk
    // These are only needed for X402 payment flows, which this dapp doesn't use
    config.externals = config.externals || [];
    config.externals.push({
      '@x402/evm/upto/client': 'commonjs @x402/evm/upto/client',
      '@x402/evm/exact/client': 'commonjs @x402/evm/exact/client',
      '@x402/core/client': 'commonjs @x402/core/client',
      '@x402/svm/exact/client': 'commonjs @x402/svm/exact/client',
      '@x402/evm': 'commonjs @x402/evm',
    });
    return config;
  },
};

export default nextConfig;
