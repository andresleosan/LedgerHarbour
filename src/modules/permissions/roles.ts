export const MembershipRole = [
  "owner_admin",
  "general_admin",
  "administrator",
] as const;

export type MembershipRole = (typeof MembershipRole)[number];
