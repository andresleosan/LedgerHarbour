import { beforeEach, describe, expect, it, vi } from "vitest";

const limit = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.10" })),
}));

vi.mock("../../src/modules/security/rate-limit", () => ({
  createAuthRateLimiter: vi.fn(() => ({ limit })),
}));

import { enforceAuthRateLimit } from "../../src/modules/security/auth-rate-limit";

describe("enforceAuthRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redacts upstream limiter failures before they reach server logs", async () => {
    limit.mockRejectedValue(new Error("WRONGPASS invalid or missing auth token"));

    await expect(enforceAuthRateLimit("email", "user@example.com"))
      .rejects.toMatchObject({ code: "AUTH_PROVIDER_FAILURE", message: "Authentication is temporarily unavailable." });
    await expect(enforceAuthRateLimit("email", "user@example.com"))
      .rejects.not.toHaveProperty("cause");
  });
});
