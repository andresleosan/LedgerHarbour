import { describe, expect, it } from "vitest";

import { resolvePostLoginDestination } from "../../../src/modules/auth/post-login-destination";
import { createInMemoryPlatformRepository, PLATFORM_ERROR_CODES } from "../../../src/modules/platform/platform-service";
import { createInMemoryOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import type { UserId } from "../../../src/modules/tenancy/types";

const identity = (email: string, providerUserId = email) => ({
  provider: "firebase" as const,
  providerUserId,
  email,
  displayName: email.split("@", 1)[0] ?? "User",
  emailVerified: true,
});

describe("post-login destination", () => {
  it("routes a linked active platform administrator to admin", async () => {
    const tenancyRepository = createInMemoryOnboardingRepository();
    const platformRepository = createInMemoryPlatformRepository();
    const actor = identity("linked@example.com");
    const userId = await tenancyRepository.upsertUser(actor);
    platformRepository.addMember({ id: "platform-linked", userId, normalizedEmail: actor.email });

    await expect(resolvePostLoginDestination(actor, { tenancyRepository, platformRepository }))
      .resolves.toBe("/admin");
  });

  it("claims a verified seeded administrator and routes to admin", async () => {
    const tenancyRepository = createInMemoryOnboardingRepository();
    const platformRepository = createInMemoryPlatformRepository();
    const actor = identity("claim@example.com");
    platformRepository.addMember({ id: "platform-claim", userId: null, normalizedEmail: actor.email });

    await expect(resolvePostLoginDestination(actor, { tenancyRepository, platformRepository }))
      .resolves.toBe("/admin");
    expect(platformRepository.platformMembers[0]?.userId).toMatch(/^user-/);
  });

  it("routes an ordinary authenticated user to onboarding", async () => {
    const tenancyRepository = createInMemoryOnboardingRepository();
    const platformRepository = createInMemoryPlatformRepository();

    await expect(resolvePostLoginDestination(identity("ordinary@example.com"), {
      tenancyRepository,
      platformRepository,
    })).resolves.toBe("/onboarding");
  });

  it("does not hide a conflicting platform claim", async () => {
    const tenancyRepository = createInMemoryOnboardingRepository();
    const platformRepository = createInMemoryPlatformRepository();
    platformRepository.addMember({
      id: "platform-conflict",
      userId: "already-linked" as UserId,
      normalizedEmail: "conflict@example.com",
    });

    await expect(resolvePostLoginDestination(identity("conflict@example.com"), {
      tenancyRepository,
      platformRepository,
    })).rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.REPOSITORY_CONFLICT });
  });

  it("rethrows unexpected repository failures", async () => {
    const tenancyRepository = createInMemoryOnboardingRepository();
    const platformRepository = createInMemoryPlatformRepository();
    const databaseError = new Error("database unavailable");
    platformRepository.findActiveMemberByUserId = async () => { throw databaseError; };

    await expect(resolvePostLoginDestination(identity("failure@example.com"), {
      tenancyRepository,
      platformRepository,
    })).rejects.toBe(databaseError);
  });
});
