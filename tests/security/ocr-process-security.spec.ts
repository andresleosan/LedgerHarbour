import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentIdentity, enforceAuthenticatedRateLimit } = vi.hoisted(() => ({
  getCurrentIdentity: vi.fn(),
  enforceAuthenticatedRateLimit: vi.fn(),
}));

vi.mock("../../src/modules/auth/session", () => ({ getCurrentIdentity }));
vi.mock(import("../../src/modules/security/authenticated-rate-limit"), async (importOriginal) => ({
  ...(await importOriginal()),
  enforceAuthenticatedRateLimit,
}));

import { POST } from "../../src/app/api/documents/[documentId]/process/route";
import { AuthenticatedRateLimitError, AuthenticatedRateLimitUnavailableError } from "../../src/modules/security/rate-limit-errors";

describe("OCR process security boundary", () => {
  beforeEach(() => {
    getCurrentIdentity.mockReturnValue({ providerUserId: "firebase-user-1", email: "user@example.com", displayName: "User", emailVerified: true });
    enforceAuthenticatedRateLimit.mockReset().mockResolvedValue(undefined);
  });

  it("returns a generic 429 before parsing the request body when process is limited", async () => {
    enforceAuthenticatedRateLimit.mockRejectedValue(new AuthenticatedRateLimitError());
    const json = vi.fn();

    const response = await POST({ headers: new Headers(), json } as unknown as Request, { params: Promise.resolve({ documentId: "document-id" }) });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: { code: "RATE_LIMITED", message: "Too many requests." } });
    expect(json).not.toHaveBeenCalled();
  });

  it("returns a generic 503 before parsing when the process limiter is unavailable", async () => {
    enforceAuthenticatedRateLimit.mockRejectedValue(new AuthenticatedRateLimitUnavailableError());
    const json = vi.fn();

    const response = await POST({ headers: new Headers(), json } as unknown as Request, { params: Promise.resolve({ documentId: "document-id" }) });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: { code: "RATE_LIMIT_UNAVAILABLE", message: "OCR protection is temporarily unavailable." } });
    expect(json).not.toHaveBeenCalled();
  });
});
