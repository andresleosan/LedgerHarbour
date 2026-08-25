import { describe, expect, it } from "vitest";

import { PostgresRateLimiter } from "../../src/modules/security/postgres-rate-limit";

describe("PostgresRateLimiter", () => {
  it("uses an atomic fixed-window upsert and does not store the raw key", async () => {
    let queryText = "";
    let queryValues: readonly unknown[] = [];
    const limiter = new PostgresRateLimiter({
      maxRequests: 2,
      windowMs: 300_000,
      keySecret: "unit-rate-limit-secret",
      now: () => 301_000,
      query: async (text: string, values?: readonly unknown[]) => {
        queryText = text;
        queryValues = values ?? [];
        return { rows: [{ request_count: 1, reset_at_ms: 300_000 }] };
      },
    });

    await expect(limiter.limit("auth:email:203.0.113.4:person@example.com")).resolves.toEqual({
      success: true,
      remaining: 1,
      resetAt: 600_000,
    });
    expect(queryText).toContain("ON CONFLICT (key_hash, window_started_at)");
    expect(queryText).toContain("request_count = rate_limit_windows.request_count + 1");
    expect(queryValues).not.toContain("auth:email:203.0.113.4:person@example.com");
    expect(queryValues[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails closed on malformed database rows", async () => {
    const limiter = new PostgresRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      keySecret: "unit-rate-limit-secret",
      query: async () => ({ rows: [{ request_count: "not-a-number", reset_at_ms: 0 }] }),
    });

    await expect(limiter.limit("auth:test")).rejects.toThrow("malformed data");
  });
});
