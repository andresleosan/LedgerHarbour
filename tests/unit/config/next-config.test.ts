import { describe, expect, it } from "vitest";

import { createNextConfig } from "../../../next.config";

describe("Next environment configuration", () => {
  it.each(["development", "test"])("allows only the Playwright origin in %s", (nodeEnv) => {
    const config = createNextConfig(nodeEnv);

    expect(config.allowedDevOrigins).toEqual(["127.0.0.1"]);
  });

  it("omits development origins from production", () => {
    const config = createNextConfig("production");

    expect(config).not.toHaveProperty("allowedDevOrigins");
  });

  it("preserves both Firebase rewrites in production", async () => {
    const config = createNextConfig("production");

    await expect(config.rewrites?.()).resolves.toEqual([
      {
        source: "/__/auth/:path*",
        destination: "https://ledgerharbour.firebaseapp.com/__/auth/:path*",
      },
      {
        source: "/__/firebase/:path*",
        destination: "https://ledgerharbour.firebaseapp.com/__/firebase/:path*",
      },
    ]);
  });
});
