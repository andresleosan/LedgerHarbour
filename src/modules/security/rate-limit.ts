export interface RateLimitResult {
  readonly success: boolean;
  readonly remaining: number;
  readonly resetAt: number;
}

export interface RateLimiter {
  limit(key: string): Promise<RateLimitResult>;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface InMemoryRateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  now?: () => number;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: InMemoryRateLimiterOptions) {
    if (!Number.isInteger(options.maxRequests) || options.maxRequests < 1) throw new Error("maxRequests must be a positive integer");
    if (!Number.isFinite(options.windowMs) || options.windowMs < 1) throw new Error("windowMs must be positive");
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
  }

  async limit(key: string): Promise<RateLimitResult> {
    const now = this.now();
    const existing = this.entries.get(key);
    const entry = !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + this.windowMs }
      : existing;
    entry.count += 1;
    this.entries.set(key, entry);
    return {
      success: entry.count <= this.maxRequests,
      remaining: Math.max(0, this.maxRequests - entry.count),
      resetAt: entry.resetAt,
    };
  }
}

class UpstashRateLimiter implements RateLimiter {
  constructor(private readonly limiter: Pick<Ratelimit, "limit">) {}

  async limit(key: string): Promise<RateLimitResult> {
    const result = await this.limiter.limit(key);
    return { success: result.success, remaining: result.remaining, resetAt: result.reset };
  }
}

let sharedRateLimiter: RateLimiter | null = null;

export function createAuthRateLimiter(): RateLimiter {
  const mode = process.env.RATE_LIMIT_MODE ?? "memory";
  if (mode === "memory") {
    return sharedRateLimiter ??= new InMemoryRateLimiter({ maxRequests: 10, windowMs: 5 * 60 * 1000 });
  }
  if (mode !== "upstash") throw new Error("Unsupported rate limit mode");
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error("Upstash rate limiting requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN");
  }
  return sharedRateLimiter ??= new UpstashRateLimiter(new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.fixedWindow(10, "5 m"),
    analytics: false,
    prefix: "ledgerharbour:auth",
  }));
}
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
