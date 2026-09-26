import type { Permission } from "@/lib/permissions/catalog";

export interface RoleAssignmentView {
  id: string;
  scope: "ORGANIZATION" | "PROPERTY";
  role: { id: string; code: string; name: string };
  property: { id: string; code: string; name: string } | null;
  createdAt: string;
}

export interface UserView {
  id: string;
  email: string;
  displayName: string;
  status: "INVITED" | "ACTIVE" | "LOCKED" | "DISABLED";
  lockedUntil: string | null;
  lastLoginAt: string | null;
  assignments: RoleAssignmentView[];
}

export interface RoleView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  permissions: Permission[];
}

/** Returned once to the administrator; the token is never stored or logged. */
export interface PasswordResetIssued {
  userId: string;
  /** One-time link; the token is in the URL fragment. */
  resetUrl: string;
  expiresAt: string;
  sessionsRevoked: number;
}
