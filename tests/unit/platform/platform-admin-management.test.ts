import { describe, expect, it } from "vitest";

import { createInMemoryOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import {
  createInMemoryPlatformRepository,
  createPlatformService,
  PLATFORM_ERROR_CODES,
} from "../../../src/modules/platform/platform-service";
import type { UserId } from "../../../src/modules/tenancy/types";

const user = (value: string) => value as UserId;

function fixture() {
  const tenancy = createInMemoryOnboardingRepository();
  const platform = createInMemoryPlatformRepository();
  platform.addMember({ id: "platform-owner", userId: user("platform-owner"), normalizedEmail: "owner@example.com" });
  return { tenancy, platform, service: createPlatformService({ tenancyRepository: tenancy, platformRepository: platform }) };
}

describe("platform administrator management", () => {
  it("adds an unlinked normalized platform administrator and audits the reason", async () => {
    const { service, platform } = fixture();

    const added = await service.addPlatformAdministrator(user("platform-owner"), {
      email: "  New.Admin@Example.COM ",
      reason: "On-call rotation",
    });

    expect(added).toMatchObject({
      id: expect.any(String),
      email: "new.admin@example.com",
      role: "platform_admin",
      userId: null,
      isActive: true,
    });
    expect(platform.auditEvents).toContainEqual(expect.objectContaining({
      action: "platform_admin_added",
      targetType: "platform_member",
      targetId: added.id,
      reason: "On-call rotation",
      actorId: "platform-owner",
    }));
  });

  it("rejects duplicates and never authorizes by email alone", async () => {
    const { service } = fixture();

    await expect(service.addPlatformAdministrator("owner@example.com" as never, {
      email: "another@example.com",
      reason: "Must be denied",
    })).rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED });
    await service.addPlatformAdministrator(user("platform-owner"), { email: "duplicate@example.com", reason: "Initial" });
    await expect(service.addPlatformAdministrator(user("platform-owner"), { email: "DUPLICATE@example.com", reason: "Duplicate" }))
      .rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.DUPLICATE_PLATFORM_ADMIN });
  });

  it("deactivates with CAS and refuses to remove the last active administrator", async () => {
    const { service, platform } = fixture();
    const second = await service.addPlatformAdministrator(user("platform-owner"), { email: "second@example.com", reason: "Second operator" });

    const results = await Promise.allSettled([
      service.removePlatformAdministrator(second.id, user("platform-owner"), { reason: "Offboarding" }),
      service.removePlatformAdministrator(second.id, user("platform-owner"), { reason: "Concurrent offboarding" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(platform.platformMembers.find((member) => member.id === second.id)).toMatchObject({ isActive: false });
    expect(platform.auditEvents.filter((event) => event.targetId === second.id && event.action === "platform_admin_removed")).toHaveLength(1);

    await expect(service.removePlatformAdministrator("platform-owner", user("platform-owner"), { reason: "Last admin" }))
      .rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.LAST_PLATFORM_ADMIN });
  });

  it("keeps one active administrator when concurrent removals target the final two", async () => {
    const { service, platform } = fixture();
    const second = await service.addPlatformAdministrator(user("platform-owner"), { email: "second.concurrent@example.com", reason: "Second operator" });

    const results = await Promise.allSettled([
      service.removePlatformAdministrator("platform-owner", user("platform-owner"), { reason: "Concurrent removal one" }),
      service.removePlatformAdministrator(second.id, user("platform-owner"), { reason: "Concurrent removal two" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(platform.platformMembers.filter((member) => member.isActive)).toHaveLength(1);
  });

  it("revalidates the actor before adding after the actor is deactivated", async () => {
    const { service, platform } = fixture();
    platform.addMember({ id: "platform-2", userId: user("platform-2"), normalizedEmail: "second@example.com" });

    let releaseInitialCheck!: () => void;
    const initialCheck = new Promise<void>((resolve) => { releaseInitialCheck = resolve; });
    let initialCheckStarted!: () => void;
    const initialCheckReached = new Promise<void>((resolve) => { initialCheckStarted = resolve; });
    const findActiveMember = platform.findActiveMemberByUserId.bind(platform);
    let firstCheck = true;
    platform.findActiveMemberByUserId = async (userId) => {
      const member = await findActiveMember(userId);
      const snapshot = member ? { ...member } : null;
      if (firstCheck && userId === user("platform-owner")) {
        firstCheck = false;
        initialCheckStarted();
        await initialCheck;
      }
      return snapshot;
    };

    const addPromise = service.addPlatformAdministrator(user("platform-owner"), {
      email: "race-add@example.com",
      reason: "Race add",
    });
    await initialCheckReached;
    await service.removePlatformAdministrator("platform-owner", user("platform-2"), { reason: "Deactivate actor" });
    releaseInitialCheck();

    await expect(addPromise).rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED });
    expect(platform.platformMembers.some((member) => member.normalizedEmail === "race-add@example.com")).toBe(false);
    expect(platform.auditEvents.some((event) => event.action === "platform_admin_added" && event.reason === "Race add")).toBe(false);
  });

  it("revalidates the actor before removing after the actor is deactivated", async () => {
    const { service, platform } = fixture();
    platform.addMember({ id: "platform-2", userId: user("platform-2"), normalizedEmail: "second@example.com" });
    platform.addMember({ id: "platform-3", userId: user("platform-3"), normalizedEmail: "third@example.com" });

    let releaseInitialCheck!: () => void;
    const initialCheck = new Promise<void>((resolve) => { releaseInitialCheck = resolve; });
    let initialCheckStarted!: () => void;
    const initialCheckReached = new Promise<void>((resolve) => { initialCheckStarted = resolve; });
    const findActiveMember = platform.findActiveMemberByUserId.bind(platform);
    let firstCheck = true;
    platform.findActiveMemberByUserId = async (userId) => {
      const member = await findActiveMember(userId);
      const snapshot = member ? { ...member } : null;
      if (firstCheck && userId === user("platform-owner")) {
        firstCheck = false;
        initialCheckStarted();
        await initialCheck;
      }
      return snapshot;
    };

    const removePromise = service.removePlatformAdministrator("platform-2", user("platform-owner"), { reason: "Race remove" });
    await initialCheckReached;
    await service.removePlatformAdministrator("platform-owner", user("platform-2"), { reason: "Deactivate actor" });
    releaseInitialCheck();

    await expect(removePromise).rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED });
    expect(platform.platformMembers.find((member) => member.id === "platform-2")).toMatchObject({ isActive: true });
    expect(platform.auditEvents.some((event) => event.targetId === "platform-2" && event.reason === "Race remove")).toBe(false);
  });
});
