import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createInMemoryOnboardingRepository,
} from "../../../src/modules/tenancy/business-service";
import {
  createMembershipService,
  MEMBERSHIP_ERROR_CODES,
  type RemoveAdministratorInput,
  type SetGeneralAdminInput,
  type TransferOwnershipInput,
} from "../../../src/modules/tenancy/membership-service";
import { requireBusinessOperational } from "../../../src/modules/tenancy/business-lifecycle-service";
import type { UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const user = (value: string) => value as UserId;

async function fixture() {
  const repository = createInMemoryOnboardingRepository();
  const created = await createApprovedBusiness(repository, "Harbour Books Ltd", user("owner"));
  const general = await repository.createMembership({ membershipId: "membership-general", userId: user("general"), businessId: created.id, role: "general_admin", isActive: true, status: "active" });
  const administrator = await repository.createMembership({ membershipId: "membership-administrator", userId: user("administrator"), businessId: created.id, role: "administrator", isActive: true, status: "active" });
  return { repository, service: createMembershipService(repository), created, general, administrator };
}

describe("membership administration", () => {
  beforeEach(() => vi.useRealTimers());

  it("allows only the owner to assign and remove a General Admin", async () => {
    const { repository, service, created, administrator } = await fixture();
    const input: SetGeneralAdminInput = { businessId: created.id, membershipId: administrator.membershipId };

    await expect(service.setGeneralAdmin(input, user("general"))).rejects.toMatchObject({
      code: MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY,
    });
    await expect(service.setGeneralAdmin(input, user("owner"))).resolves.toMatchObject({
      userId: user("administrator"),
      role: "general_admin",
    });
    await expect(service.removeAdministrator({ ...input }, user("general"))).rejects.toMatchObject({
      code: MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY,
    });
    await expect(service.removeAdministrator({ ...input }, user("owner"))).resolves.toBeUndefined();
    expect(repository.memberships.some((membership) => membership.userId === user("administrator"))).toBe(false);
    expect(repository.auditEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining(["membership_role_changed", "membership_removed"]),
    );
  });

  it("targets the internal membership id rather than the user id and audits that id", async () => {
    const repository = createInMemoryOnboardingRepository();
    const created = await createApprovedBusiness(repository, "Internal Membership IDs", user("owner"));
    const target = await repository.createMembership({
      membershipId: "membership-target",
      userId: user("provider-user-is-not-membership-id"),
      businessId: created.id,
      role: "administrator",
      isActive: true,
      status: "active",
    });

    expect(target.membershipId).not.toBe(target.userId);
    await createMembershipService(repository).setGeneralAdmin(
      { businessId: created.id, membershipId: target.membershipId! },
      user("owner"),
    );

    expect(repository.auditEvents).toContainEqual(expect.objectContaining({
      type: "membership_role_changed",
      entityId: target.membershipId,
    }));
  });

  it("allows a General Admin to remove a regular Administrator but never an owner or General Admin", async () => {
    const { repository, service, created, administrator } = await fixture();
    const regular: RemoveAdministratorInput = { businessId: created.id, membershipId: administrator.membershipId };

    await expect(service.removeAdministrator(regular, user("general"))).resolves.toBeUndefined();
    expect(repository.memberships.some((membership) => membership.userId === user("administrator"))).toBe(false);

    const secondAdministrator = await repository.createMembership({ membershipId: "membership-administrator-2", userId: user("administrator-2"), businessId: created.id, role: "administrator", isActive: true, status: "active" });
    const owner = (await repository.findMembership(user("owner"), created.id))!;
    const general = (await repository.findMembership(user("general"), created.id))!;
    await expect(service.removeAdministrator({ businessId: created.id, membershipId: owner.membershipId }, user("general")))
      .rejects.toMatchObject({ code: MEMBERSHIP_ERROR_CODES.OWNER_PROTECTED });
    await expect(service.removeAdministrator({ businessId: created.id, membershipId: general.membershipId }, user("general")))
      .rejects.toMatchObject({ code: MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY });
    expect(secondAdministrator.membershipId).not.toBe(secondAdministrator.userId);
  });

  it("denies every membership mutation from an ordinary Administrator", async () => {
    vi.setSystemTime(new Date("2026-08-11T12:00:00.000Z"));
    const { service, created } = await fixture();

    await expect(service.setGeneralAdmin({ businessId: created.id, membershipId: "administrator" }, user("administrator")))
      .rejects.toMatchObject({ code: MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY });
    await expect(service.removeAdministrator({ businessId: created.id, membershipId: "general" }, user("administrator")))
      .rejects.toMatchObject({ code: MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY });
    await expect(service.transferOwnership({
      businessId: created.id,
      targetMembershipId: "general",
      confirmationName: "Harbour Books Ltd",
      reauthenticatedAt: "2026-08-11T11:59:00.000Z",
    }, user("administrator"))).rejects.toMatchObject({ code: MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY });
  });

  it("transfers ownership atomically and keeps exactly one active owner", async () => {
    vi.setSystemTime(new Date("2026-08-11T12:00:00.000Z"));
    const { repository, service, created, general } = await fixture();
    const input: TransferOwnershipInput = {
      businessId: created.id,
      targetMembershipId: general.membershipId,
      confirmationName: "Harbour Books Ltd",
      reauthenticatedAt: "2026-08-11T11:58:00.000Z",
    };

    await expect(service.transferOwnership(input, user("general"))).rejects.toMatchObject({
      code: MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY,
    });
    await expect(service.transferOwnership(input, user("owner"))).resolves.toBeUndefined();
    expect(repository.memberships.filter((membership) => membership.role === "owner_admin" && membership.isActive)).toEqual([
       { membershipId: general.membershipId, userId: user("general"), businessId: created.id, role: "owner_admin", isActive: true, status: "active" },
    ]);
    expect(repository.memberships.find((membership) => membership.userId === user("owner"))).toMatchObject({ role: "administrator" });
    expect(repository.auditEvents).toContainEqual(expect.objectContaining({ type: "ownership_transferred" }));
  });

  it("rejects missing, mismatched, stale, future, and non-ISO confirmation markers", async () => {
    vi.setSystemTime(new Date("2026-08-11T12:00:00.000Z"));
    const { service, created, general } = await fixture();
    const base = { businessId: created.id, targetMembershipId: general.membershipId };
    const cases: TransferOwnershipInput[] = [
      { ...base, confirmationName: "", reauthenticatedAt: "2026-08-11T11:59:00.000Z" },
      { ...base, confirmationName: "Other", reauthenticatedAt: "2026-08-11T11:59:00.000Z" },
      { ...base, confirmationName: "Harbour Books Ltd", reauthenticatedAt: "2026-08-11T11:54:59.999Z" },
      { ...base, confirmationName: "Harbour Books Ltd", reauthenticatedAt: "2026-08-11T12:00:00.001Z" },
       { ...base, confirmationName: "Harbour Books Ltd", reauthenticatedAt: "not-a-date" },
       { ...base, confirmationName: "Harbour Books Ltd", reauthenticatedAt: "2026-08-11T11:59:00Z" },
       { ...base, confirmationName: "Harbour Books Ltd", reauthenticatedAt: "2026-08-11T11:59:00+00:00" },
       { ...base, confirmationName: "Harbour Books Ltd", reauthenticatedAt: "2026-08-11" },
    ];

    for (const input of cases) {
      await expect(service.transferOwnership(input, user("owner"))).rejects.toMatchObject({
        code: MEMBERSHIP_ERROR_CODES.CONFIRMATION_REQUIRED,
      });
    }
  });

  it("hides cross-business targets and protects the owner invariant", async () => {
    const { repository, service, created, administrator } = await fixture();
    const second = await createApprovedBusiness(repository, "Second Books", user("owner-2"));

    await expect(service.setGeneralAdmin({ businessId: created.id, membershipId: "owner-2" }, user("owner")))
      .rejects.toMatchObject({ code: MEMBERSHIP_ERROR_CODES.MEMBER_NOT_FOUND });
    await expect(service.transferOwnership({
      businessId: created.id,
      targetMembershipId: "owner-2",
      confirmationName: "Harbour Books Ltd",
      reauthenticatedAt: new Date().toISOString(),
    }, user("owner"))).rejects.toMatchObject({ code: MEMBERSHIP_ERROR_CODES.MEMBER_NOT_FOUND });

    await repository.createMembership({ membershipId: "membership-second-owner", userId: user("second-owner-copy"), businessId: created.id, role: "owner_admin", isActive: true, status: "active" });
    await expect(service.setGeneralAdmin({ businessId: created.id, membershipId: administrator.membershipId }, user("owner")))
      .rejects.toMatchObject({ code: MEMBERSHIP_ERROR_CODES.INVARIANT_CONFLICT });
    expect(second.id).not.toBe(created.id);
  });

  it("rejects every membership mutation for an inactive business", async () => {
    const { repository, service, created, administrator } = await fixture();
    repository.businesses.get(created.id)!.isActive = false;

    await expect(service.setGeneralAdmin({ businessId: created.id, membershipId: administrator.membershipId }, user("owner")))
      .rejects.toMatchObject({ code: MEMBERSHIP_ERROR_CODES.INACTIVE_BUSINESS });
    await expect(service.removeAdministrator({ businessId: created.id, membershipId: administrator.membershipId }, user("owner")))
      .rejects.toMatchObject({ code: MEMBERSHIP_ERROR_CODES.INACTIVE_BUSINESS });
  });

  it("accepts the existing repository boundary without exposing it in the service result", async () => {
    const { service, created } = await fixture();
    const result = await service.listMemberships(created.id, user("owner"));
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: user("owner"), role: "owner_admin" }),
    ]));
    expect(result[0]).not.toHaveProperty("repository");
  });

  it("derives only actor-authorized member actions in safe DTOs", async () => {
    const { service, created } = await fixture();

    const ownerView = await service.listMemberships(created.id, user("owner"));
    expect(ownerView.find((member) => member.userId === user("administrator"))).toMatchObject({
      capabilities: ["set_general_admin", "remove_administrator", "transfer_ownership"],
    });
    expect(ownerView.find((member) => member.userId === user("general"))).toMatchObject({
      capabilities: ["remove_general_admin", "transfer_ownership"],
    });

    const generalView = await service.listMemberships(created.id, user("general"));
    expect(generalView.find((member) => member.userId === user("administrator"))).toMatchObject({
      capabilities: ["remove_administrator"],
    });
    expect(generalView.find((member) => member.userId === user("general"))).toMatchObject({ capabilities: [] });
    expect(generalView.find((member) => member.userId === user("owner"))).toMatchObject({ capabilities: [] });
  });

  it("exports an operational guard for future business mutation modules", async () => {
    const { repository, created } = await fixture();

    await expect(requireBusinessOperational(repository, created.id)).resolves.toMatchObject({
      id: created.id,
      isActive: true,
    });
    repository.businesses.get(created.id)!.isActive = false;
    await expect(requireBusinessOperational(repository, created.id)).rejects.toMatchObject({
      code: "INACTIVE_BUSINESS",
    });
  });
});
