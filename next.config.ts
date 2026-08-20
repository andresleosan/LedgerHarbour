import type { NextConfig } from "next";

const PLAYWRIGHT_DEV_ORIGIN = "127.0.0.1:3100";

export function createNextConfig(nodeEnv: string | undefined = process.env.NODE_ENV): NextConfig {
  return {
    ...(nodeEnv === "development" || nodeEnv === "test"
      ? { allowedDevOrigins: [PLAYWRIGHT_DEV_ORIGIN] }
      : {}),
    experimental: {
      middlewareClientMaxBodySize: 12 * 1024 * 1024,
    },
    async headers() {
      return [
        {
          source: "/(.*)",
          headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }],
        },
      ];
    },
    async rewrites() {
      return [
        {
          source: "/__/auth/:path*",
          destination: "https://ledgerharbour.firebaseapp.com/__/auth/:path*",
        },
        {
          source: "/__/firebase/:path*",
          destination: "https://ledgerharbour.firebaseapp.com/__/firebase/:path*",
        },
      ];
    },
  };
}

export default createNextConfig();
