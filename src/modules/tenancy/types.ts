import type { MembershipRole } from "../permissions/roles";

export type UserId = string & { readonly __brand: "UserId" };
export type BusinessId = string & { readonly __brand: "BusinessId" };

export const MembershipStatus = ["pending", "active", "suspended", "revoked"] as const;
export type MembershipStatus = (typeof MembershipStatus)[number];

export const BusinessStatus = ["pending", "active", "suspended", "rejected"] as const;
export type BusinessStatus = (typeof BusinessStatus)[number];

export interface Membership {
  membershipId: string;
  userId: UserId;
  businessId: BusinessId;
  role: MembershipRole;
  isActive: boolean;
  status: MembershipStatus;
}
