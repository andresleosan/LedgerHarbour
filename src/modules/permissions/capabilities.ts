export const Capability = [
  "read_finance",
  "edit_finance",
  "approve_administrator",
  "remove_administrator",
  "suspend_administrator",
  "revoke_administrator",
  "manage_general_admin",
  "transfer_ownership",
  "deactivate_business",
  "reactivate_business",
  "manage_projects",
] as const;

export type Capability = (typeof Capability)[number];
