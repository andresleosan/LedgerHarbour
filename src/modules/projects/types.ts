import type { BusinessId, UserId } from "../tenancy/types";

export const ProjectStatus = ["pending", "active", "rejected", "suspended"] as const;
export type ProjectStatus = (typeof ProjectStatus)[number];

export const ProjectMembershipRole = ["owner", "member"] as const;
export type ProjectMembershipRole = (typeof ProjectMembershipRole)[number];

export const ProjectMembershipStatus = ["pending", "active", "suspended", "revoked"] as const;
export type ProjectMembershipStatus = (typeof ProjectMembershipStatus)[number];

export interface Project {
  id: string;
  businessId: BusinessId;
  name: string;
  normalizedName: string;
  status: ProjectStatus;
  isActive: boolean;
  createdBy: UserId;
  reviewedBy: string | null;
  reviewedAt: string | null;
  activatedAt: string | null;
  rejectedAt: string | null;
  suspendedAt: string | null;
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMembership {
  membershipId: string;
  projectId: string;
  userId: UserId;
  role: ProjectMembershipRole;
  isActive: boolean;
  status: ProjectMembershipStatus;
}

export interface ProjectLifecycleUpdate {
  status: ProjectStatus;
  isActive: boolean;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  activatedAt?: string | null;
  rejectedAt?: string | null;
  suspendedAt?: string | null;
  statusReason?: string | null;
}

export interface ProjectDto {
  id: string;
  businessId: BusinessId;
  name: string;
  status: ProjectStatus;
  isActive: boolean;
  requesterId: UserId;
  reviewedAt: string | null;
  activatedAt: string | null;
  rejectedAt: string | null;
  suspendedAt: string | null;
  statusReason: string | null;
  createdAt: string;
}

export type ProjectAccessDenialReason =
  | "project_not_found"
  | "business_not_found"
  | "business_pending"
  | "business_rejected"
  | "business_suspended"
  | "project_pending"
  | "project_rejected"
  | "project_suspended"
  | "membership_required"
  | "membership_inactive";

export type EffectiveProjectAccess =
  | { allowed: true; project: Project; membership: ProjectMembership; reason: null }
  | { allowed: false; project: null; membership: null; reason: ProjectAccessDenialReason };
