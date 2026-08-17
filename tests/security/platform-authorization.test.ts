import { describe, expect, it, vi } from "vitest";

import { createBusinessRequest, createInMemoryOnboardingRepository } from "../../src/modules/tenancy/business-service";
import {
  createInMemoryPlatformRepository,
  createPlatformService,
  PLATFORM_ERROR_CODES,
} from "../../src/modules/platform/platform-service";
import type { UserId } from "../../src/modules/tenancy/types";

vi.mock("../../src/modules/auth/session", () => ({
  getCurrentIdentity: vi.fn(async () => ({
    providerUserId: "provider-user",
    email: "ordinary@example.com",
    displayName: "Ordinary User",
    emailVerified: true,
  })),
}));

const user = (value: string) => value as UserId;

describe("platform administration authorization", () => {
  it("denies global business APIs to a non-platform user even when they know the business ID", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    const business = await createBusinessRequest({ name: "Tenant Harbour" }, user("requester"), tenancy);
    const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });

    await expect(service.listBusinesses(user("requester"))).rejects.toMatchObject({
      code: PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED,
    });
    await expect(service.approveBusiness(business.id, user("requester"), { serviceExpiresAt: "2026-09-16T00:00:00.000Z" })).rejects.toMatchObject({
      code: PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED,
    });
  });

  it("does not authorize a platform administrator from an email string alone", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });

    await expect(service.listBusinesses("admin@example.com" as never)).rejects.toMatchObject({
      code: PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED,
    });
  });

  it("returns a generic forbidden response from the platform API", async () => {
    const { GET } = await import("../../src/app/api/platform/businesses/route");
    const response = await GET();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "PLATFORM_ACCESS_DENIED", message: "Platform administration access denied." },
    });
  });
});
