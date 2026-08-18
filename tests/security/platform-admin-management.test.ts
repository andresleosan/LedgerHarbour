import { describe, expect, it } from "vitest";

import { createInMemoryOnboardingRepository } from "../../src/modules/tenancy/business-service";
import { createInMemoryPlatformRepository, createPlatformService, PLATFORM_ERROR_CODES } from "../../src/modules/platform/platform-service";
import type { UserId } from "../../src/modules/tenancy/types";

const user = (value: string) => value as UserId;

describe("platform administrator management security", () => {
  it("does not allow an ordinary identity to add or remove platform administrators", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    platform.addMember({ id: "platform-1", userId: user("platform-1"), normalizedEmail: "platform@example.com" });
    const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });

    await expect(service.addPlatformAdministrator(user("ordinary"), { email: "new@example.com", reason: "Unauthorized" }))
      .rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED });
    await expect(service.removePlatformAdministrator("platform-1", user("ordinary"), { reason: "Unauthorized" }))
      .rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED });
    expect(platform.platformMembers).toHaveLength(1);
  });

  it("keeps a newly added administrator claimable only by verified Firebase identity", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    platform.addMember({ id: "platform-1", userId: user("platform-1"), normalizedEmail: "platform@example.com" });
    const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
    const added = await service.addPlatformAdministrator(user("platform-1"), { email: "claim@example.com", reason: "Verified handoff" });

    await expect(service.claimPlatformMember({ provider: "development", providerUserId: "dev", email: "claim@example.com", displayName: "Dev", emailVerified: true }))
      .rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED });
    await expect(service.claimPlatformMember({ provider: "firebase", providerUserId: "firebase-claim", email: "claim@example.com", displayName: "Claim", emailVerified: false }))
      .rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED });
    await expect(service.claimPlatformMember({ provider: "firebase", providerUserId: "firebase-claim", email: "claim@example.com", displayName: "Claim", emailVerified: true }))
      .resolves.toMatchObject({ id: added.id, userId: expect.any(String) });
  });
});
