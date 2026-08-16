import { beforeEach, describe, expect, it, vi } from "vitest";

const limit = vi.hoisted(() => vi.fn());
const createAuthenticatedRateLimiter = vi.hoisted(() => vi.fn(() => ({ limit })));

vi.mock("../../src/modules/security/rate-limit", () => ({ createAuthenticatedRateLimiter }));

import { enforceAuthenticatedRateLimit } from "../../src/modules/security/authenticated-rate-limit";

describe("authenticated endpoint rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limit.mockResolvedValue({ success: true, remaining: 1, resetAt: 1234 });
  });

  it("keys upload limits by authenticated identity and scope only", async () => {
    await expect(enforceAuthenticatedRateLimit("upload", "firebase-user-1")).resolves.toBeUndefined();

    expect(createAuthenticatedRateLimiter).toHaveBeenCalledWith("upload");
    expect(limit).toHaveBeenCalledWith("authenticated:upload:firebase-user-1");
  });

  it("keeps OCR process limits in a separate scope", async () => {
    await enforceAuthenticatedRateLimit("ocr-process", "firebase-user-1");

    expect(createAuthenticatedRateLimiter).toHaveBeenCalledWith("ocr-process");
    expect(limit).toHaveBeenCalledWith("authenticated:ocr-process:firebase-user-1");
  });

  it("returns one generic error for exceeded or unavailable limiters", async () => {
    limit.mockResolvedValueOnce({ success: false, remaining: 0, resetAt: 1234 });
    await expect(enforceAuthenticatedRateLimit("upload", "firebase-user-1"))
      .rejects.toMatchObject({ code: "AUTHENTICATED_RATE_LIMITED", message: "Too many requests." });

    limit.mockRejectedValueOnce(new Error("upstream token and input@example.com"));
    await expect(enforceAuthenticatedRateLimit("ocr-process", "firebase-user-1"))
      .rejects.toMatchObject({ code: "AUTHENTICATED_RATE_LIMITED", message: "Too many requests." });
  });
});
