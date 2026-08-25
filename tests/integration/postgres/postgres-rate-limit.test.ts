import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { applyMigration } from "../../../src/db/test-database";
import { PostgresRateLimiter, type RateLimitRow } from "../../../src/modules/security/postgres-rate-limit";

describe("PostgreSQL rate limiter", () => {
  it("increments atomically, resets at the fixed window, and stores only the digest", async () => {
    const client = new PGlite();
    await applyMigration(
      client,
      await readFile(new URL("../../../src/db/migrations/0007_rate_limit_windows.sql", import.meta.url), "utf8"),
    );

    let now = 1_000;
    const limiter = new PostgresRateLimiter({
      maxRequests: 2,
      windowMs: 60_000,
      keySecret: "integration-rate-limit-secret",
      now: () => now,
      query: async (text, values) => {
        const result = await client.query<RateLimitRow>(text, values ? [...values] : undefined);
        return { rows: result.rows };
      },
    });

    await expect(limiter.limit("auth:email:203.0.113.4:person@example.com")).resolves.toMatchObject({ success: true, remaining: 1, resetAt: 60_000 });
    await expect(limiter.limit("auth:email:203.0.113.4:person@example.com")).resolves.toMatchObject({ success: true, remaining: 0, resetAt: 60_000 });
    await expect(limiter.limit("auth:email:203.0.113.4:person@example.com")).resolves.toMatchObject({ success: false, remaining: 0, resetAt: 60_000 });

    const rows = await client.query<{ key_hash: string }>("SELECT key_hash FROM rate_limit_windows");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.key_hash).toMatch(/^[0-9a-f]{64}$/);

    now = 60_000;
    await expect(limiter.limit("auth:email:203.0.113.4:person@example.com")).resolves.toMatchObject({ success: true, remaining: 1, resetAt: 120_000 });

    await client.close();
  }, 30_000);
});
