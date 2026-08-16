import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentIdentity, enforceAuthenticatedRateLimit } = vi.hoisted(() => ({
  getCurrentIdentity: vi.fn(),
  enforceAuthenticatedRateLimit: vi.fn(),
}));

vi.mock("../../src/modules/auth/session", () => ({ getCurrentIdentity }));
vi.mock("../../src/modules/security/authenticated-rate-limit", () => ({ enforceAuthenticatedRateLimit }));

import { POST } from "../../src/app/api/documents/[documentId]/process/route";

describe("OCR process security boundary", () => {
  beforeEach(() => {
    getCurrentIdentity.mockReturnValue({ providerUserId: "firebase-user-1", email: "user@example.com", displayName: "User", emailVerified: true });
    enforceAuthenticatedRateLimit.mockReset().mockResolvedValue(undefined);
  });

  it("returns a generic 429 before parsing the request body when process is limited", async () => {
    enforceAuthenticatedRateLimit.mockRejectedValue(new Error("private limiter document-id"));
    const json = vi.fn();

    const response = await POST({ headers: new Headers(), json } as unknown as Request, { params: Promise.resolve({ documentId: "document-id" }) });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: { code: "RATE_LIMITED", message: "Too many requests." } });
    expect(json).not.toHaveBeenCalled();
  });
});
