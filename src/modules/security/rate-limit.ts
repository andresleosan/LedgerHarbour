import { createPostgresRateLimiter } from "./postgres-rate-limit";

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

const sharedRateLimiters = new Map<string, RateLimiter>();

function createConfiguredRateLimiter(definition: RateLimitDefinition): RateLimiter {
  const mode = process.env.RATE_LIMIT_MODE ?? (process.env.NODE_ENV === "production" ? "" : "memory");
  if (process.env.NODE_ENV === "production" && mode !== "postgres") {
    throw new Error("PostgreSQL rate limiting is required in production");
  }
  if (mode === "memory") {
    const key = `memory:${definition.keyPrefix}`;
    const existing = sharedRateLimiters.get(key);
    if (existing) return existing;
    const maxRequests = process.env.NODE_ENV === "test" && process.env.LEDGERHARBOUR_PLAYWRIGHT_HARNESS === "true"
      ? Math.max(definition.maxRequests, 100)
      : definition.maxRequests;
    const limiter = new InMemoryRateLimiter({ maxRequests, windowMs: definition.windowMs });
    sharedRateLimiters.set(key, limiter);
    return limiter;
  }
  if (mode !== "postgres") throw new Error("Unsupported rate limit mode");
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("PostgreSQL rate limiting requires DATABASE_URL");
  const keySecret = process.env.RATE_LIMIT_KEY_SECRET?.trim();
  if (!keySecret) throw new Error("PostgreSQL rate limiting requires RATE_LIMIT_KEY_SECRET");

  const key = `postgres:${definition.keyPrefix}`;
  const existing = sharedRateLimiters.get(key);
  if (existing) return existing;
  const limiter = createPostgresRateLimiter(databaseUrl, {
    maxRequests: definition.maxRequests,
    windowMs: definition.windowMs,
    keySecret,
  });
  sharedRateLimiters.set(key, limiter);
  return limiter;
}

const AUTH_RATE_LIMIT: RateLimitDefinition = {
  keyPrefix: "auth",
  maxRequests: 10,
  windowMs: 5 * 60 * 1000,
};

const AUTHENTICATED_RATE_LIMITS = {
  upload: {
    keyPrefix: "authenticated-upload",
    maxRequests: 10,
    windowMs: 5 * 60 * 1000,
  },
  "ocr-process": {
    keyPrefix: "authenticated-ocr-process",
    maxRequests: 5,
    windowMs: 5 * 60 * 1000,
  },
  "project-request": {
    keyPrefix: "authenticated-project-request",
    maxRequests: 10,
    windowMs: 5 * 60 * 1000,
  },
  "project-membership": {
    keyPrefix: "authenticated-project-membership",
    maxRequests: 20,
    windowMs: 5 * 60 * 1000,
  },
  "platform-administration": {
    keyPrefix: "authenticated-platform-administration",
    maxRequests: 30,
    windowMs: 5 * 60 * 1000,
  },
} satisfies Record<string, RateLimitDefinition>;

export type AuthenticatedRateLimitScope = keyof typeof AUTHENTICATED_RATE_LIMITS;

const AGGREGATED_RATE_LIMITS = {
  upload: {
    keyPrefix: "authenticated-upload-address",
    maxRequests: 20,
    windowMs: 5 * 60 * 1000,
  },
  "ocr-process": {
    keyPrefix: "authenticated-ocr-process-address",
    maxRequests: 10,
    windowMs: 5 * 60 * 1000,
  },
  "project-request": {
    keyPrefix: "authenticated-project-request-address",
    maxRequests: 20,
    windowMs: 5 * 60 * 1000,
  },
  "project-membership": {
    keyPrefix: "authenticated-project-membership-address",
    maxRequests: 40,
    windowMs: 5 * 60 * 1000,
  },
  "platform-administration": {
    keyPrefix: "authenticated-platform-administration-address",
    maxRequests: 60,
    windowMs: 5 * 60 * 1000,
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
