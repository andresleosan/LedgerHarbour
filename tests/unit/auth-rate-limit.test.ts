import { beforeEach, describe, expect, it, vi } from "vitest";

const limit = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.10" })),
}));

vi.mock("../../src/modules/security/rate-limit", () => ({
  createAuthRateLimiter: vi.fn(() => ({ limit })),
}));

import { headers } from "next/headers";

import { enforceAuthRateLimit } from "../../src/modules/security/auth-rate-limit";

describe("enforceAuthRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the verified Pages address for the authentication bucket", async () => {
    vi.stubEnv("LEDGERHARBOUR_TRUSTED_PROXY", "cloudflare-pages");
    try {
      vi.mocked(headers).mockResolvedValueOnce(new Headers({
        "x-ledgerharbour-client-ip": "192.0.2.12",
        "x-forwarded-for": "198.51.100.12",
      }));
      limit.mockResolvedValueOnce({ success: true });
      await enforceAuthRateLimit("google");
      expect(limit).toHaveBeenCalledWith("auth:google:192.0.2.12:");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("redacts upstream limiter failures before they reach server logs", async () => {
    limit.mockRejectedValue(new Error("WRONGPASS invalid or missing auth token"));

    await expect(enforceAuthRateLimit("email", "user@example.com"))
      .rejects.toMatchObject({ code: "AUTH_PROVIDER_FAILURE", message: "Authentication is temporarily unavailable." });
    await expect(enforceAuthRateLimit("email", "user@example.com"))
      .rejects.not.toHaveProperty("cause");
  });
});
