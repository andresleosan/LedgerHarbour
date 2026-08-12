export const Capability = [
  "read_finance",
  "edit_finance",
  "approve_administrator",
  "remove_administrator",
  "manage_general_admin",
  "transfer_ownership",
  "deactivate_business",
  "reactivate_business",
] as const;

export type Capability = (typeof Capability)[number];
