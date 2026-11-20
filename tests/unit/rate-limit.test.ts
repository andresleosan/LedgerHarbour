import { describe, expect, it, vi } from "vitest";

import {
  createAggregatedRateLimiter,
  createAuthenticatedRateLimiter,
  createAuthRateLimiter,
  InMemoryRateLimiter,
  resetRateLimitersForTests,
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

  it("fails closed when PostgreSQL mode has no database URL", () => {
    vi.stubEnv("RATE_LIMIT_MODE", "postgres");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("RATE_LIMIT_KEY_SECRET", "test-rate-limit-secret");

    expect(() => createAuthRateLimiter()).toThrow("PostgreSQL rate limiting requires DATABASE_URL");
    vi.unstubAllEnvs();
  });

  it("requires PostgreSQL instead of memory in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.RATE_LIMIT_MODE = "memory";

    try {
      expect(() => createAuthenticatedRateLimiter("upload")).toThrow("PostgreSQL rate limiting is required");
    } finally {
      vi.unstubAllEnvs();
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

  it("creates aggregate address limiters separately from identity limiters", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RATE_LIMIT_MODE", "memory");

    expect(createAggregatedRateLimiter("upload")).not.toBe(createAuthenticatedRateLimiter("upload"));
    expect(createAggregatedRateLimiter("ocr-process")).not.toBe(createAuthenticatedRateLimiter("ocr-process"));
    vi.unstubAllEnvs();
  });

  it("does not exhaust the shared test auth limiter during a browser suite", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RATE_LIMIT_MODE", "memory");
    vi.stubEnv("LEDGERHARBOUR_PLAYWRIGHT_HARNESS", "true");
    resetRateLimitersForTests();
    const limiter = createAuthRateLimiter();

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await expect(limiter.limit("auth:test-browser")).resolves.toMatchObject({ success: true });
    }

    resetRateLimitersForTests();
    vi.unstubAllEnvs();
  });

  it("raises the harness limit under the development NODE_ENV that next dev compiles in", async () => {
    resetRateLimitersForTests(); // only clears while NODE_ENV is "test"
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RATE_LIMIT_MODE", "memory");
    vi.stubEnv("LEDGERHARBOUR_PLAYWRIGHT_HARNESS", "true");
    const limiter = createAuthRateLimiter();

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await expect(limiter.limit("auth:dev-browser")).resolves.toMatchObject({ success: true });
    }

    vi.unstubAllEnvs();
    resetRateLimitersForTests();
  });

  it("keeps the real limit in development without the harness flag", async () => {
    resetRateLimitersForTests();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RATE_LIMIT_MODE", "memory");
    vi.stubEnv("LEDGERHARBOUR_PLAYWRIGHT_HARNESS", "");
    const limiter = createAuthRateLimiter();

    for (let attempt = 0; attempt < 10; attempt += 1) await limiter.limit("auth:dev-plain");
    await expect(limiter.limit("auth:dev-plain")).resolves.toMatchObject({ success: false });

    vi.unstubAllEnvs();
    resetRateLimitersForTests();
  });
});
