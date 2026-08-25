import { createHmac } from "node:crypto";

import { Pool } from "pg";

import type { RateLimitResult, RateLimiter } from "./rate-limit";

export type RateLimitRow = {
  request_count: number | string;
  reset_at_ms: number | string;
};

export type PostgresRateLimitQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<{ rows: RateLimitRow[] }>;

export type PostgresRateLimiterOptions = {
  maxRequests: number;
  windowMs: number;
  keySecret: string;
  now?: () => number;
  query?: PostgresRateLimitQuery;
};

const pools = new Map<string, Pool>();

function getPool(databaseUrl: string): Pool {
  const existing = pools.get(databaseUrl);
  if (existing) return existing;

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
  });
  pools.set(databaseUrl, pool);
  return pool;
}

function hashKey(key: string, keySecret: string): string {
  return createHmac("sha256", keySecret).update(key).digest("hex");
}

export class PostgresRateLimiter implements RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly keySecret: string;
  private readonly now: () => number;
  private readonly query: PostgresRateLimitQuery;

  constructor(options: PostgresRateLimiterOptions) {
    if (!Number.isInteger(options.maxRequests) || options.maxRequests < 1) {
      throw new Error("maxRequests must be a positive integer");
    }
    if (!Number.isFinite(options.windowMs) || options.windowMs < 1) {
      throw new Error("windowMs must be positive");
    }
    if (options.keySecret.trim().length < 16) throw new Error("RATE_LIMIT_KEY_SECRET must be at least 16 characters");

    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
    this.keySecret = options.keySecret;
    this.now = options.now ?? Date.now;
    this.query = options.query ?? (() => {
      throw new Error("A PostgreSQL query function is required");
    });
  }

  async limit(key: string): Promise<RateLimitResult> {
    if (typeof key !== "string" || !key.trim() || key.length > 512) {
      throw new Error("Rate-limit key is invalid");
    }

    const now = this.now();
    const windowStartMs = Math.floor(now / this.windowMs) * this.windowMs;
    const windowStart = new Date(windowStartMs);
    const keyHash = hashKey(key, this.keySecret);
    const result = await this.query(
      `WITH cleanup AS (
         DELETE FROM rate_limit_windows
         WHERE key_hash = $1 AND window_started_at < $2::timestamptz
         RETURNING key_hash
       )
       INSERT INTO rate_limit_windows (key_hash, window_started_at, request_count)
       VALUES ($1, $2::timestamptz, 1)
       ON CONFLICT (key_hash, window_started_at)
       DO UPDATE SET request_count = rate_limit_windows.request_count + 1
       RETURNING request_count, (EXTRACT(EPOCH FROM window_started_at) * 1000)::bigint AS reset_at_ms`,
      [keyHash, windowStart.toISOString()],
    );

    const row = result.rows[0];
    if (!row) throw new Error("PostgreSQL rate-limit query returned no row");

    const requestCount = Number(row.request_count);
    const resetAt = Number(row.reset_at_ms) + this.windowMs;
    if (!Number.isSafeInteger(requestCount) || !Number.isSafeInteger(resetAt)) {
      throw new Error("PostgreSQL rate-limit query returned malformed data");
    }

    return {
      success: requestCount <= this.maxRequests,
      remaining: Math.max(0, this.maxRequests - requestCount),
      resetAt,
    };
  }
}

export function createPostgresRateLimiter(
  databaseUrl: string,
  options: Omit<PostgresRateLimiterOptions, "query">,
): PostgresRateLimiter {
  const pool = getPool(databaseUrl);
  return new PostgresRateLimiter({
    ...options,
    query: async (text: string, values?: readonly unknown[]) => {
      const result = await pool.query(text, values ? [...values] : undefined);
      return { rows: result.rows as RateLimitRow[] };
    },
  });
}

export function closePostgresRateLimitPoolsForTests(): Promise<void[]> {
  const activePools = [...pools.values()];
  pools.clear();
  return Promise.all(activePools.map((pool) => pool.end()));
}
