import { describe, expect, it, vi } from "vitest";

import {
  createAuthenticatedRateLimiter,
  createAuthRateLimiter,
  InMemoryRateLimiter,
} from "../../src/modules/security/rate-limit";

describe("InMemoryRateLimiter", () => {
  it("allows the configured number of requests and blocks the next one", async () => {
    let now = 1_000;
    const limiter = new InMemoryRateLimiter({ maxRequests: 2, windowMs: 60_000, now: () => now });

    await expect(limiter.limit("auth:user@example.com")).resolves.toMatchObject({ success: true, remaining: 1 });
    await expect(limiter.limit("auth:user@example.com")).resolves.toMatchObject({ success: true, remaining: 0 });
    await expect(limiter.limit("auth:user@example.com")).resolves.toMatchObject({ success: false, remaining: 0, resetAt: 61_000 });

    now = 61_000;
    await expect(limiter.limit("auth:user@example.com")).resolves.toMatchObject({ success: true, remaining: 1 });
  });

  it("keeps independent keys isolated", async () => {
    const limiter = new InMemoryRateLimiter({ maxRequests: 1, windowMs: 60_000, now: () => 1_000 });

    await expect(limiter.limit("ip:one")).resolves.toMatchObject({ success: true });
    await expect(limiter.limit("ip:two")).resolves.toMatchObject({ success: true });
    await expect(limiter.limit("ip:one")).resolves.toMatchObject({ success: false });
  });

  it("fails closed when Upstash mode has no credentials", () => {
    vi.stubEnv("RATE_LIMIT_MODE", "upstash");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");

    expect(() => createAuthRateLimiter()).toThrow("Upstash rate limiting requires");
    vi.unstubAllEnvs();
  });

  it("requires Upstash instead of memory in production", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.RATE_LIMIT_MODE = "memory";

    try {
      expect(() => createAuthenticatedRateLimiter("upload")).toThrow("Upstash rate limiting is required");
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      vi.unstubAllEnvs();
    }
  });

  it("creates independent limiter instances for upload and OCR process", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RATE_LIMIT_MODE", "memory");

    const uploadLimiter = createAuthenticatedRateLimiter("upload");
    const processLimiter = createAuthenticatedRateLimiter("ocr-process");

    expect(uploadLimiter).not.toBe(processLimiter);
    vi.unstubAllEnvs();
  });
});
