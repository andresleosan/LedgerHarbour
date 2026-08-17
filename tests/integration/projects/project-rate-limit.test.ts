import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import type { AuthIdentity } from "../../../src/modules/auth/auth-provider";
import { getCurrentIdentity } from "../../../src/modules/auth/session";

const rateLimitResponse = vi.hoisted(() => vi.fn());

vi.mock("../../../src/modules/security/authenticated-rate-limit", async () => {
  const actual = await vi.importActual<typeof import("../../../src/modules/security/authenticated-rate-limit")>("../../../src/modules/security/authenticated-rate-limit");
  return { ...actual, authenticatedRateLimitResponse: rateLimitResponse };
});
vi.mock("../../../src/modules/auth/session", () => ({ getCurrentIdentity: vi.fn() }));

import { POST as createProject } from "../../../src/app/api/businesses/[businessId]/projects/route";
import { POST as addProjectMember } from "../../../src/app/api/businesses/[businessId]/projects/[projectId]/members/route";

const identity: AuthIdentity = {
  provider: "firebase",
  providerUserId: "task5-rate-limit-user",
  email: "task5-rate-limit@example.com",
  displayName: "Rate Limit User",
  emailVerified: true,
};

const mockedIdentity = vi.mocked(getCurrentIdentity);

function requestWithBody(path: string, body: unknown): Request & { json: ReturnType<typeof vi.fn> } {
  const request = new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.80" },
    body: JSON.stringify(body),
  });
  const json = vi.fn(async () => body);
  Object.defineProperty(request, "json", { value: json });
  return request as Request & { json: ReturnType<typeof vi.fn> };
}

describe("project write rate limits", () => {
  beforeEach(() => {
    rateLimitResponse.mockReset();
    mockedIdentity.mockResolvedValue(identity);
  });

  it("limits project creation before reading the request body", async () => {
    rateLimitResponse.mockResolvedValue(NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429 }));
    const request = requestWithBody("/api/businesses/business-1/projects", { name: "Project" });

    const response = await createProject(request, { params: Promise.resolve({ businessId: "business-1" }) });

    expect(response.status).toBe(429);
    expect(rateLimitResponse).toHaveBeenCalledWith("project-request", request, identity);
    expect(request.json).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: { code: "RATE_LIMITED", message: "Too many requests." } });
  });

  it("returns a generic unavailable response for project membership writes before reading the body", async () => {
    rateLimitResponse.mockResolvedValue(NextResponse.json({ error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Platform protection is temporarily unavailable." } }, { status: 503 }));
    const request = requestWithBody("/api/businesses/business-1/projects/project-1/members", { userId: "user-2", role: "member" });

    const response = await addProjectMember(request, { params: Promise.resolve({ businessId: "business-1", projectId: "project-1" }) });

    expect(response.status).toBe(503);
    expect(rateLimitResponse).toHaveBeenCalledWith("project-membership", request, identity);
    expect(request.json).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Platform protection is temporarily unavailable." } });
  });
});
