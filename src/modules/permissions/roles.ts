export const MembershipRole = [
  "owner_admin",
  "general_admin",
  "administrator",
] as const;

export type MembershipRole = (typeof MembershipRole)[number];

export const PlatformRole = ["platform_admin"] as const;

export type PlatformRole = (typeof PlatformRole)[number];

export type AuthorizationRole = MembershipRole | PlatformRole;
