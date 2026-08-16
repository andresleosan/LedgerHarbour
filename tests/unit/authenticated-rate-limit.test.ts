import { beforeEach, describe, expect, it, vi } from "vitest";

const limit = vi.hoisted(() => vi.fn());
const createAuthenticatedRateLimiter = vi.hoisted(() => vi.fn(() => ({ limit })));

vi.mock("../../src/modules/security/rate-limit", () => ({ createAuthenticatedRateLimiter }));

import { enforceAuthenticatedRateLimit } from "../../src/modules/security/authenticated-rate-limit";
import { AuthenticatedRateLimitError, AuthenticatedRateLimitUnavailableError } from "../../src/modules/security/rate-limit-errors";

describe("authenticated endpoint rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limit.mockResolvedValue({ success: true, remaining: 1, resetAt: 1234 });
  });

  it("keys upload limits by authenticated identity, scope, and edge address", async () => {
    await expect(enforceAuthenticatedRateLimit("upload", "firebase-user-1", new Headers({
      "x-vercel-forwarded-for": "203.0.113.10",
      "x-forwarded-for": "198.51.100.10",
    }))).resolves.toBeUndefined();

    expect(createAuthenticatedRateLimiter).toHaveBeenCalledWith("upload");
    expect(limit).toHaveBeenCalledWith("authenticated:upload:firebase-user-1:203.0.113.10");
  });

  it("keeps OCR process limits in a separate scope", async () => {
    await enforceAuthenticatedRateLimit("ocr-process", "firebase-user-1", new Headers({ "x-forwarded-for": "198.51.100.20, 198.51.100.21" }));

    expect(createAuthenticatedRateLimiter).toHaveBeenCalledWith("ocr-process");
    expect(limit).toHaveBeenCalledWith("authenticated:ocr-process:firebase-user-1:198.51.100.20");
  });

  it("uses x-real-ip as the final address fallback", async () => {
    await enforceAuthenticatedRateLimit("upload", "firebase-user-1", new Headers({ "x-real-ip": "192.0.2.10" }));

    expect(limit).toHaveBeenCalledWith("authenticated:upload:firebase-user-1:192.0.2.10");
  });

  it("separates abuse 429 from unavailable limiter 503 errors", async () => {
    limit.mockResolvedValueOnce({ success: false, remaining: 0, resetAt: 1234 });
    await expect(enforceAuthenticatedRateLimit("upload", "firebase-user-1", new Headers()))
      .rejects.toBeInstanceOf(AuthenticatedRateLimitError);

    limit.mockRejectedValueOnce(new Error("upstream token and input@example.com"));
    await expect(enforceAuthenticatedRateLimit("ocr-process", "firebase-user-1", new Headers()))
      .rejects.toBeInstanceOf(AuthenticatedRateLimitUnavailableError);
  });
});
