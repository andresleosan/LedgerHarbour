import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

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

type RateLimitDefinition = {
  keyPrefix: string;
  maxRequests: number;
  windowMs: number;
  upstashWindow: Parameters<typeof Ratelimit.fixedWindow>[1];
};

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

const sharedRateLimiters = new Map<string, RateLimiter>();

function createConfiguredRateLimiter(definition: RateLimitDefinition): RateLimiter {
  const mode = process.env.RATE_LIMIT_MODE ?? (process.env.NODE_ENV === "production" ? "" : "memory");
  if (process.env.NODE_ENV === "production" && mode !== "upstash") {
    throw new Error("Upstash rate limiting is required in production");
  }
  if (mode === "memory") {
    const key = `memory:${definition.keyPrefix}`;
    const existing = sharedRateLimiters.get(key);
    if (existing) return existing;
    const limiter = new InMemoryRateLimiter({ maxRequests: definition.maxRequests, windowMs: definition.windowMs });
    sharedRateLimiters.set(key, limiter);
    return limiter;
  }
  if (mode !== "upstash") throw new Error("Unsupported rate limit mode");
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error("Upstash rate limiting requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN");
  }

  const key = `upstash:${definition.keyPrefix}`;
  const existing = sharedRateLimiters.get(key);
  if (existing) return existing;
  const limiter = new UpstashRateLimiter(new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.fixedWindow(definition.maxRequests, definition.upstashWindow),
    analytics: false,
    prefix: `ledgerharbour:${definition.keyPrefix}`,
  }));
  sharedRateLimiters.set(key, limiter);
  return limiter;
}

const AUTH_RATE_LIMIT: RateLimitDefinition = {
  keyPrefix: "auth",
  maxRequests: 10,
  windowMs: 5 * 60 * 1000,
  upstashWindow: "5 m",
};

const AUTHENTICATED_RATE_LIMITS = {
  upload: {
    keyPrefix: "authenticated-upload",
    maxRequests: 10,
    windowMs: 5 * 60 * 1000,
    upstashWindow: "5 m",
  },
  "ocr-process": {
    keyPrefix: "authenticated-ocr-process",
    maxRequests: 5,
    windowMs: 5 * 60 * 1000,
    upstashWindow: "5 m",
  },
  "project-request": {
    keyPrefix: "authenticated-project-request",
    maxRequests: 10,
    windowMs: 5 * 60 * 1000,
    upstashWindow: "5 m",
  },
  "project-membership": {
    keyPrefix: "authenticated-project-membership",
    maxRequests: 20,
    windowMs: 5 * 60 * 1000,
    upstashWindow: "5 m",
  },
  "platform-administration": {
    keyPrefix: "authenticated-platform-administration",
    maxRequests: 30,
    windowMs: 5 * 60 * 1000,
    upstashWindow: "5 m",
  },
} satisfies Record<string, RateLimitDefinition>;

export type AuthenticatedRateLimitScope = keyof typeof AUTHENTICATED_RATE_LIMITS;

const AGGREGATED_RATE_LIMITS = {
  upload: {
    keyPrefix: "authenticated-upload-address",
    maxRequests: 20,
    windowMs: 5 * 60 * 1000,
    upstashWindow: "5 m",
  },
  "ocr-process": {
    keyPrefix: "authenticated-ocr-process-address",
    maxRequests: 10,
    windowMs: 5 * 60 * 1000,
    upstashWindow: "5 m",
  },
  "project-request": {
    keyPrefix: "authenticated-project-request-address",
    maxRequests: 20,
    windowMs: 5 * 60 * 1000,
    upstashWindow: "5 m",
  },
  "project-membership": {
    keyPrefix: "authenticated-project-membership-address",
    maxRequests: 40,
    windowMs: 5 * 60 * 1000,
    upstashWindow: "5 m",
  },
  "platform-administration": {
    keyPrefix: "authenticated-platform-administration-address",
    maxRequests: 60,
    windowMs: 5 * 60 * 1000,
    upstashWindow: "5 m",
  },
} satisfies Record<AuthenticatedRateLimitScope, RateLimitDefinition>;

export function createAuthRateLimiter(): RateLimiter {
  return createConfiguredRateLimiter(AUTH_RATE_LIMIT);
}

export function createAuthenticatedRateLimiter(scope: AuthenticatedRateLimitScope): RateLimiter {
  return createConfiguredRateLimiter(AUTHENTICATED_RATE_LIMITS[scope]);
}

export function createAggregatedRateLimiter(scope: AuthenticatedRateLimitScope): RateLimiter {
  return createConfiguredRateLimiter(AGGREGATED_RATE_LIMITS[scope]);
}

export function resetRateLimitersForTests(): void {
  if (process.env.NODE_ENV === "test") sharedRateLimiters.clear();
}
