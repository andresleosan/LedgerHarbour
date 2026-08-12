import type { MembershipRole } from "../permissions/roles";

export type UserId = string & { readonly __brand: "UserId" };
export type BusinessId = string & { readonly __brand: "BusinessId" };

export interface Membership {
  membershipId: string;
  userId: UserId;
  businessId: BusinessId;
  role: MembershipRole;
  isActive: boolean;
}
